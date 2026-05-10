import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Card } from '../api/types';

export interface FilterState {
  search: string;
  labels: string[];
  status: string | null;
  setSearch: (search: string) => void;
  toggleLabel: (label: string) => void;
  setStatus: (status: string | null) => void;
  clearFilters: () => void;
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set) => ({
      search: '',
      labels: [],
      status: null,
      setSearch: (search) => set({ search }),
      toggleLabel: (label) =>
        set((state) => ({
          labels: state.labels.includes(label)
            ? state.labels.filter((item) => item !== label)
            : [...state.labels, label],
        })),
      setStatus: (status) => set({ status }),
      clearFilters: () => set({ search: '', labels: [], status: null }),
    }),
    { name: 'kanban-filters' },
  ),
);

export function applyFilters(cards: Card[], filters: FilterState): Card[] {
  return cards.filter((card) => {
    if (filters.search && !card.title.toLowerCase().includes(filters.search.toLowerCase())) {
      return false;
    }

    if (filters.labels.length > 0 && !filters.labels.some((label) => card.labels.includes(label))) {
      return false;
    }

    if (filters.status && card.status !== filters.status) {
      return false;
    }

    return true;
  });
}
