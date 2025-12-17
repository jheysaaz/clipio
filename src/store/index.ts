import { configureStore } from "@reduxjs/toolkit";
import themeReducer from "./slices/themeSlice";
import toastReducer from "./slices/toastSlice";

export const store = configureStore({
  reducer: {
    theme: themeReducer,
    toast: toastReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
