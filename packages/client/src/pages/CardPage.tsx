import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { api } from '@/api/client';
import { CardDetailPage } from '@/components/card/CardDetailPage';

export function CardPage() {
  const { id } = useParams<{ id: string }>();

  const { data: cardDetail, isLoading } = useQuery({
    queryKey: ['cards', id],
    queryFn: () => api.cards.get(id!),
    enabled: !!id,
  });

  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.agents.list(),
  });

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!cardDetail) {
    return <div>Card not found</div>;
  }

  return <CardDetailPage card={cardDetail.card} agents={agents ?? []} />;
}
