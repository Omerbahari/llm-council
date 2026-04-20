"""3-stage LLM Council orchestration."""

from typing import List, Dict, Any, Tuple, Optional
from .openrouter import query_models_parallel, query_model
from .config import COUNCIL_MODELS, CHAIRMAN_MODEL


def _decode_text_file(file: Dict[str, Any]) -> Optional[str]:
    """Best-effort decode of a base64 text file. Returns None on failure."""
    import base64
    try:
        raw = base64.b64decode(file.get("data_base64", ""))
        return raw.decode("utf-8", errors="replace")
    except Exception:
        return None


def build_history_messages(prior_messages: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Convert stored conversation messages into chat-style history.

    Each stored user message becomes `{"role": "user", "content": ...}` and
    each stored assistant message becomes `{"role": "assistant", "content": ...}`
    using the Stage 3 (chairman) synthesis as the canonical assistant reply.

    Skips partial/loading messages and any assistant messages without a Stage 3
    response (e.g., if the stream failed mid-flight).
    """
    history: List[Dict[str, Any]] = []
    for msg in prior_messages or []:
        role = msg.get("role")
        if role == "user":
            text = msg.get("content") or ""
            files = msg.get("files") or []
            if files:
                attached = ", ".join(f.get("name") or "file" for f in files)
                text = (text + f"\n\n[Attached: {attached}]").strip()
            if text:
                history.append({"role": "user", "content": text})
        elif role == "assistant":
            stage3 = msg.get("stage3") or {}
            reply = stage3.get("response") if isinstance(stage3, dict) else None
            if reply:
                history.append({"role": "assistant", "content": reply})
    return history


def _build_user_message(user_query: str, files: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Build a (possibly multimodal) user message from text + attached files.

    Images are passed as image_url parts (base64 data URLs) so vision-capable
    council members can see them. Text-like files are inlined into the prompt
    so all models can reason over them.
    """
    files = files or []
    if not files:
        return {"role": "user", "content": user_query}

    text_parts: List[str] = [user_query] if user_query else []
    content_parts: List[Dict[str, Any]] = []
    has_image = False

    for f in files:
        mime = (f.get("type") or "").lower()
        name = f.get("name") or "attachment"
        b64 = f.get("data_base64") or ""
        if mime.startswith("image/"):
            has_image = True
            content_parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}"},
            })
        elif mime.startswith("text/") or any(
            name.lower().endswith(ext) for ext in (".txt", ".md", ".json", ".csv", ".log", ".py", ".js", ".ts", ".yaml", ".yml")
        ):
            decoded = _decode_text_file(f)
            if decoded is not None:
                text_parts.append(f"\n\n--- Attached file: {name} ---\n{decoded}\n--- end file ---")
        else:
            text_parts.append(f"\n\n[Attached non-text file: {name} ({mime}) — not readable]")

    combined_text = "\n".join(t for t in text_parts if t)

    if has_image:
        # Must use multimodal content array when any image is present
        content: List[Dict[str, Any]] = [{"type": "text", "text": combined_text or ""}]
        content.extend(content_parts)
        return {"role": "user", "content": content}

    return {"role": "user", "content": combined_text}


async def stage1_collect_responses(
    user_query: str,
    files: Optional[List[Dict[str, Any]]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """
    Stage 1: Collect individual responses from all council models.

    Args:
        user_query: The user's question
        files: Optional list of file attachments (images pass as vision input)
        history: Optional prior chat turns to give models continuity.

    Returns:
        List of dicts with 'model' and 'response' keys
    """
    messages: List[Dict[str, Any]] = []
    if history:
        messages.extend(history)
    messages.append(_build_user_message(user_query, files))

    # Query all models in parallel
    responses = await query_models_parallel(COUNCIL_MODELS, messages)

    # Format results
    stage1_results = []
    for model, response in responses.items():
        if response is not None:  # Only include successful responses
            stage1_results.append({
                "model": model,
                "response": response.get('content', '')
            })

    return stage1_results


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Stage 2: Each model ranks the anonymized responses.

    Args:
        user_query: The original user query
        stage1_results: Results from Stage 1

    Returns:
        Tuple of (rankings list, label_to_model mapping)
    """
    # Create anonymized labels for responses (Response A, Response B, etc.)
    labels = [chr(65 + i) for i in range(len(stage1_results))]  # A, B, C, ...

    # Create mapping from label to model name
    label_to_model = {
        f"Response {label}": result['model']
        for label, result in zip(labels, stage1_results)
    }

    # Build the ranking prompt
    responses_text = "\n\n".join([
        f"Response {label}:\n{result['response']}"
        for label, result in zip(labels, stage1_results)
    ])

    ranking_prompt = f"""You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:"""

    messages = [{"role": "user", "content": ranking_prompt}]

    # Get rankings from all council models in parallel
    responses = await query_models_parallel(COUNCIL_MODELS, messages)

    # Format results
    stage2_results = []
    for model, response in responses.items():
        if response is not None:
            full_text = response.get('content', '')
            parsed = parse_ranking_from_text(full_text)
            stage2_results.append({
                "model": model,
                "ranking": full_text,
                "parsed_ranking": parsed
            })

    return stage2_results, label_to_model


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    history: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response.

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from Stage 1
        stage2_results: Rankings from Stage 2
        history: Optional prior chat turns so the chairman has continuity.

    Returns:
        Dict with 'model' and 'response' keys
    """
    # Build comprehensive context for chairman
    stage1_text = "\n\n".join([
        f"Model: {result['model']}\nResponse: {result['response']}"
        for result in stage1_results
    ])

    stage2_text = "\n\n".join([
        f"Model: {result['model']}\nRanking: {result['ranking']}"
        for result in stage2_results
    ])

    chairman_prompt = f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to the user's latest question, and then ranked each other's responses. The prior chat history is provided in the preceding messages for context.

User's Latest Question: {user_query}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's latest question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement
- The prior conversation so your reply stays coherent with what was already said

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    messages: List[Dict[str, Any]] = []
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": chairman_prompt})

    # Query the chairman model
    response = await query_model(CHAIRMAN_MODEL, messages)

    if response is None:
        # Fallback if chairman fails
        return {
            "model": CHAIRMAN_MODEL,
            "response": "Error: Unable to generate final synthesis."
        }

    return {
        "model": CHAIRMAN_MODEL,
        "response": response.get('content', '')
    }


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Args:
        ranking_text: The full text response from the model

    Returns:
        List of response labels in ranked order
    """
    import re

    # Look for "FINAL RANKING:" section
    if "FINAL RANKING:" in ranking_text:
        # Extract everything after "FINAL RANKING:"
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            # Try to extract numbered list format (e.g., "1. Response A")
            # This pattern looks for: number, period, optional space, "Response X"
            numbered_matches = re.findall(r'\d+\.\s*Response [A-Z]', ranking_section)
            if numbered_matches:
                # Extract just the "Response X" part
                return [re.search(r'Response [A-Z]', m).group() for m in numbered_matches]

            # Fallback: Extract all "Response X" patterns in order
            matches = re.findall(r'Response [A-Z]', ranking_section)
            return matches

    # Fallback: try to find any "Response X" patterns in order
    matches = re.findall(r'Response [A-Z]', ranking_text)
    return matches


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str]
) -> List[Dict[str, Any]]:
    """
    Calculate aggregate rankings across all models.

    Args:
        stage2_results: Rankings from each model
        label_to_model: Mapping from anonymous labels to model names

    Returns:
        List of dicts with model name and average rank, sorted best to worst
    """
    from collections import defaultdict

    # Track positions for each model
    model_positions = defaultdict(list)

    for ranking in stage2_results:
        ranking_text = ranking['ranking']

        # Parse the ranking from the structured format
        parsed_ranking = parse_ranking_from_text(ranking_text)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                model_positions[model_name].append(position)

    # Calculate average position for each model
    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions)
            })

    # Sort by average rank (lower is better)
    aggregate.sort(key=lambda x: x['average_rank'])

    return aggregate


async def generate_conversation_title(user_query: str) -> str:
    """
    Generate a short title for a conversation based on the first user message.

    Args:
        user_query: The first user message

    Returns:
        A short title (3-5 words)
    """
    title_prompt = f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: {user_query}

Title:"""

    messages = [{"role": "user", "content": title_prompt}]

    # Use gemini-2.5-flash for title generation (fast and cheap)
    response = await query_model("google/gemini-2.5-flash", messages, timeout=30.0)

    if response is None:
        # Fallback to a generic title
        return "New Conversation"

    title = response.get('content', 'New Conversation').strip()

    # Clean up the title - remove quotes, limit length
    title = title.strip('"\'')

    # Truncate if too long
    if len(title) > 50:
        title = title[:47] + "..."

    return title


async def run_full_council(
    user_query: str,
    files: Optional[List[Dict[str, Any]]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[List, List, Dict, Dict]:
    """
    Run the complete 3-stage council process.

    Args:
        user_query: The user's question
        files: Optional list of file attachments
        history: Optional prior chat turns (user/assistant) for continuity.

    Returns:
        Tuple of (stage1_results, stage2_results, stage3_result, metadata)
    """
    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(user_query, files, history=history)

    # If no models responded successfully, return error
    if not stage1_results:
        return [], [], {
            "model": "error",
            "response": "All models failed to respond. Please try again."
        }, {}

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(user_query, stage1_results)

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results,
        history=history,
    )

    # Prepare metadata
    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings
    }

    return stage1_results, stage2_results, stage3_result, metadata
