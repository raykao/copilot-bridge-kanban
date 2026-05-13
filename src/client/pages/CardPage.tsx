import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { api, getErrorMessage } from '@/api/client';
import { ErrorState } from '@/components/ErrorState';
import { CardPageSkeleton } from '@/components/PageSkeletons';
import { CardDetailPage } from '@/components/card/CardDetailPage';

export function CardPage() {
  const { id } = useParams<{ id: string }>();

  const cardQuery = useQuery({
    queryKey: ['cards', id],
    queryFn: () => api.cards.get(id!),
    enabled: !!id,
  });

  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.agents.cards(),
  });

  if (cardQuery.isPending || agentsQuery.isPending) {
    return <CardPageSkeleton />;
  }

  if (cardQuery.isError || agentsQuery.isError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <ErrorState
          message={getErrorMessage(cardQuery.error ?? agentsQuery.error, 'Failed to load the card.')}
          onRetry={() => {
            void Promise.all([cardQuery.refetch(), agentsQuery.refetch()]);
          }}
        />
      </div>
    );
  }

  const cardDetail = cardQuery.data;
  const agents = agentsQuery.data?.cards ?? [];

  if (!cardDetail) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <ErrorState message="Card not found." />
      </div>
    );
  }

  return <CardDetailPage card={cardDetail.card} comments={cardDetail.comments} agents={agents} />;
}
