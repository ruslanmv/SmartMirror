import { DEVICE_PROFILES, isDeviceProfileId } from "@smartmirror/device-capabilities";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Simulator } from "@/components/simulator/Simulator";

import "../simulator.css";

export function generateStaticParams() {
  return Object.keys(DEVICE_PROFILES).map((profile) => ({ profile }));
}

export async function generateMetadata({ params }: PageProps<"/simulator/[profile]">): Promise<Metadata> {
  const { profile } = await params;
  return { title: isDeviceProfileId(profile) ? `${DEVICE_PROFILES[profile].name} simulator` : "Simulator" };
}

export default async function SimulatorPage({ params }: PageProps<"/simulator/[profile]">) {
  const { profile } = await params;
  if (!isDeviceProfileId(profile)) notFound();
  return <Simulator key={profile} profileId={profile} />;
}
