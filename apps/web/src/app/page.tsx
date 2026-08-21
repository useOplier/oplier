import { HeroAndNav } from "@/components/landing/HeroAndNav";
import { ProductShowcase } from "@/components/landing/ProductShowcase";
import { Capabilities } from "@/components/landing/Capabilities";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { ClosingCta } from "@/components/landing/ClosingCta";
import { Footer } from "@/components/landing/Footer";

export default function LandingPage() {
  return (
    <main>
      <HeroAndNav />
      <ProductShowcase />
      <Capabilities />
      <HowItWorks />
      <ClosingCta />
      <Footer />
    </main>
  );
}
