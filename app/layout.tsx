import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata={metadataBase:new URL('https://smarttrip-ai.parivashbeikkhormizi.chatgpt.site'),title:'SmartTrip AI | Travel Smarter',description:'Personalized travel planning, an AI assistant, and itinerary management.',openGraph:{title:'SmartTrip AI',description:'You choose the destination. We build the plan together.',images:['/og.png']},twitter:{card:'summary_large_image',title:'SmartTrip AI',description:'Personalized Travel Planning',images:['/og.png']}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en" dir="rtl"><body>{children}</body></html>}
