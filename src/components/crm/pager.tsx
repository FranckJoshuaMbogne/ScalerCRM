import Link from "next/link";

type Params = Record<string, string | string[] | undefined>;

export function Pager({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Params;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      const value = Array.isArray(v) ? v[0] : v;
      if (value && k !== "page") next.set(k, value);
    }
    if (p > 1) next.set("page", String(p));
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="mt-3 flex items-center justify-between text-[13px] text-muted tabular-nums">
      <p>
        {from}–{to} of {total}
      </p>
      {pages > 1 && (
        <div className="flex gap-1">
          {page > 1 && (
            <Link href={href(page - 1)} className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 hover:bg-paper">
              Previous
            </Link>
          )}
          {page < pages && (
            <Link href={href(page + 1)} className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 hover:bg-paper">
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
