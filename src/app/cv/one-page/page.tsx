import type { Metadata } from "next";
import { CvDocument, CvToolbar } from "@/components/cv/CvDocument";

export const metadata: Metadata = {
  title: "One-page CV — Veyansiz Chetty",
  openGraph: { title: "One-page CV — Veyansiz Chetty", type: "profile", locale: "en_ZA", url: "/cv/one-page/" },
  description: "A one-page CV of Veyansiz Chetty, Platform Engineer specialising in site reliability and DevOps.",
};

export default function OnePageCv() {
  return (
    <div className="cv-page">
      <CvToolbar pdf="/cv/Veyansiz-Chetty-CV-one-page.pdf" other={{ href: "/cv/", label: "Full version" }} />
      <CvDocument variant="one-page" />
    </div>
  );
}
