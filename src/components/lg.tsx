export function Page({ title, children }: { title?: string; children: React.ReactNode }) {
  return <div className="mx-auto max-w-7xl pb-24 pt-2">{title && <h1 className="px-4 py-3 text-2xl font-bold">{title}</h1>}{children}</div>;
}
