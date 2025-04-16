"use client";

import HomePageComponent from './HomePageComponent';

// This page component simply renders the renamed HomePageComponent
// It satisfies the Next.js routing requirement for the root path.
export default function Page() {
  return <HomePageComponent />;
}