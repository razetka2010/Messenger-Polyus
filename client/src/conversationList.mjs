export function orderConversations(conversations, getActivity) {
  const saved = [];
  const others = [];
  for (const conversation of conversations) {
    (conversation.type === "saved" ? saved : others).push(conversation);
  }
  others.sort((left, right) => getActivity(right) - getActivity(left));
  return [...saved, ...others];
}

export function getConversationHeaderControls(conversation) {
  if (!conversation || conversation.pending) {
    return { search: false, push: false };
  }
  return {
    search: conversation.joined !== false,
    push: conversation.type !== "saved"
  };
}
