import { Header } from "@/components/site/Header";
import { JourneyLazy } from "@/components/site/JourneyLazy";
import { Rail } from "@/components/site/Rail";
import { Hero } from "@/components/site/Hero";
import { About } from "@/components/site/About";
import { Career } from "@/components/site/Career";
import { Results } from "@/components/site/Results";
import { Skills } from "@/components/site/Skills";
import { Contact } from "@/components/site/Contact";
import { PalettePicker } from "@/components/site/PalettePicker";

export default function Home() {
  return (
    <>
      <JourneyLazy />
      <Header />
      <Rail />
      <Hero />
      <About />
      <Career />
      <Results />
      <Skills />
      <Contact />
      <PalettePicker />
    </>
  );
}
