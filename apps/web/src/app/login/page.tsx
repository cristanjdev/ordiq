import { LoginView } from "@/features/auth/login-view";
import { parseLoginNotice, sanitizeNextPath } from "@/lib/auth-redirect";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return (
    <LoginView
      nextPath={sanitizeNextPath(first(params.next))}
      notice={parseLoginNotice(first(params.reason))}
    />
  );
}
