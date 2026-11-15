import type { Metadata } from "next";
import { Geist_Mono, Montserrat, Poppins } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["500", "600", "700"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TerraTrace · NISAR radar change explorer",
  description: "A platform for tracing and understanding changes across Earth's surface.",
  icons: { icon: "/brand/favicon.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${montserrat.variable} ${poppins.variable} ${geistMono.variable} h-full`}>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
