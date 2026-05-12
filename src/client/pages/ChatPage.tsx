import { Navigate, useParams } from 'react-router-dom';

import { ChatView } from '@/components/chat/ChatView';

export function ChatPage() {
  const { agent } = useParams<{ agent: string }>();

  if (!agent) {
    return <Navigate replace to="/board" />;
  }

  return <ChatView agentName={decodeURIComponent(agent)} />;
}
