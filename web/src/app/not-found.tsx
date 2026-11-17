import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-16 pb-16">
      <p className="font-mono text-caption text-ink-soft uppercase">404</p>
      <h1 className="wordmark mt-2 text-5xl leading-none">Off the map</h1>
      <p className="mt-4 text-title-sm">
        That page isn&apos;t in Plotted — maybe the major isn&apos;t supported yet, or the link was cut off.
      </p>
      <Link
        href="/"
        className="btn btn-primary mt-6 px-4 py-2"
      >
        Pick your school and major →
      </Link>
    </main>
  );
}
