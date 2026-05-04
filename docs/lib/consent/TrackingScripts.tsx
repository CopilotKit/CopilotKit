"use client";

import Script from "next/script";
import { useConsent } from "./ConsentContext";

const RB2B_KEY = process.env.NEXT_PUBLIC_REB2B_KEY;
const REO_KEY = process.env.NEXT_PUBLIC_REO_KEY;

const REO_SNIPPET = `!function(){var e,t,n;e="${REO_KEY ?? ""}";t=function(){if(window.Reo){window.Reo.init({clientID:"${REO_KEY ?? ""}"});}};n=document.createElement("script");n.src="https://static.reo.dev/"+e+"/reo.js";n.defer=true;n.onload=t;document.head.appendChild(n);}();`;

export function TrackingScripts() {
  const { state, hydrated } = useConsent();
  if (!hydrated) return null;

  const { analytics, marketing } = state.categories;

  return (
    <>
      {analytics && REO_KEY && (
        <Script
          id="reo-init-script"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: REO_SNIPPET }}
        />
      )}
      {marketing && (
        <>
          <Script
            id="hubspot-script"
            src="https://js.hs-scripts.com/45532593.js"
            type="text/javascript"
            strategy="lazyOnload"
            async
            defer
          />
          {RB2B_KEY && (
            <Script
              id="reb2b-script"
              strategy="afterInteractive"
              src={`https://b2bjsstore.s3.us-west-2.amazonaws.com/b/${RB2B_KEY}/${RB2B_KEY}.js.gz`}
            />
          )}
        </>
      )}
    </>
  );
}
