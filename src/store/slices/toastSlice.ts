import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastState {
  message: string;
  type: ToastType;
  isVisible: boolean;
}

const initialState: ToastState = {
  message: "",
  type: "info",
  isVisible: false,
};

const toastSlice = createSlice({
  name: "toast",
  initialState,
  reducers: {
    showToast: (
      state,
      action: PayloadAction<{ message: string; type?: ToastType }>
    ) => {
      state.message = action.payload.message;
      state.type = action.payload.type || "info";
      state.isVisible = true;
    },
    hideToast: (state) => {
      state.isVisible = false;
    },
  },
});

export const { showToast, hideToast } = toastSlice.actions;
export default toastSlice.reducer;
