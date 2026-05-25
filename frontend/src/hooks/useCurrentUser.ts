import { useQuery } from "@tanstack/react-query";

import { fetchMe } from "@/lib/auth";
import { useAuthStore } from "@/store/auth";

export function useCurrentUser() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    enabled: !!token,
  });
}
