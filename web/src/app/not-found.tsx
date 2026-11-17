import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-16 pb-16">
      <p className="font-mono text-[12px] tracking-[0.3em] text-ink-soft uppercase">404</p>
      <h1 className="riso-title mt-2 text-5xl leading-none font-extrabold tracking-tight">Off the map</h1>
      <p className="mt-4 text-lg">
        That page isn&apos;t in Plotted — maybe the major isn&apos;t supported yet, or the link was cut off.
      </p>
      <Link
        href="/"
        className="sticker mt-6 inline-block px-4 py-2 font-bold [--sticker-ink:var(--pink)]"
      >
        Pick your school and major →
      </Link>
    </main>
  );
}
