import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastState {
  items: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (t) => {
    const id = nextId++;
    set((s) => ({ items: [...s.items, { ...t, id }] }));
    // Auto-dismiss after 4.5 s. Errors stay around a touch longer so the
    // user has time to read them.
    const ttl = t.variant === "error" ? 6000 : 4500;
    setTimeout(() => {
      set((s) => ({ items: s.items.filter((x) => x.id !== id) }));
    }, ttl);
  },
  dismiss: (id) =>
    set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (message: string) => useToastStore.getState().push({ message, variant: "success" }),
  error: (message: string) => useToastStore.getState().push({ message, variant: "error" }),
  info: (message: string) => useToastStore.getState().push({ message, variant: "info" }),
};
