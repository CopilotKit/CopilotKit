import { configureStore } from '@reduxjs/toolkit';
import { EventsState } from '../redux/eventsSlice';

import {
  FLUSH,
  PAUSE,
  PERSIST,
  PURGE,
  PersistConfig,
  REGISTER,
  REHYDRATE,
  persistReducer,
  persistStore,
} from 'redux-persist';
import storage from 'redux-persist/lib/storage';
import eventsSlice from '../redux/eventsSlice';

const persistConfig: PersistConfig<EventsState> = {
  key: 'events',
  storage,
};
const persistedReducer = persistReducer(persistConfig, eventsSlice);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
