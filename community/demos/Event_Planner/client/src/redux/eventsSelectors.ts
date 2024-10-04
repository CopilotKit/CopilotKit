import { createSelector } from '@reduxjs/toolkit';
import { CATEGORY_ALL } from '../constants';
import { RootState } from './eventsStore';

export const selectEvents = (state: RootState) => state.events;

export const selectSearchKey = (state: RootState) => state.searchKey;

export const selectCategoryFilter = (state: RootState) => state.categoryFilter;

export const selectFilteredEvents = createSelector(
  selectEvents,
  selectCategoryFilter,
  selectSearchKey,
  (events, categoryFilter, searchKey) => {
    const search = searchKey.toLowerCase();
    const filteredEvents = events.filter(event => {
      const isSearchMatched =
        event.title.toLowerCase().includes(search) ||
        event.description?.toLowerCase().includes(search) ||
        event.location?.toLowerCase().includes(search);
      const isCategoryMatched =
        categoryFilter === CATEGORY_ALL ||
        event.category.includes(categoryFilter);
      return isSearchMatched && isCategoryMatched;
    });
    return filteredEvents.sort(
      (event1, event2) => event1.datetime - event2.datetime,
    );
  },
);
