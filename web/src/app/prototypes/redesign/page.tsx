import { Chakra_Petch, Instrument_Sans, JetBrains_Mono, Martian_Mono, Schibsted_Grotesk } from "next/font/google";
import { loadProgram } from "@/lib/catalog";
import { Harness } from "./harness";
import "./prototypes.css";

/** Redesign exploration only: three concepts behind a picker. Not linked from the app. */
export const metadata = { title: "Plotted — redesign prototypes", robots: { index: false } };

const schibsted = Schibsted_Grotesk({ subsets: ["latin"], variable: "--f-schibsted" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--f-jet" });
const chakra = Chakra_Petch({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--f-chakra" });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--f-instrument" });
const martian = Martian_Mono({ subsets: ["latin"], variable: "--f-martian" });

export default async function Page() {
  const { program, courses } = await loadProgram("ut-austin", "2026-28", "ut-cs-bs");
  return (
    <div
      className={`${schibsted.variable} ${jetbrains.variable} ${chakra.variable} ${instrument.variable} ${martian.variable} flex-1`}
    >
      <Harness program={program} courses={courses} />
    </div>
  );
}
