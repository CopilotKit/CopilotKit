"use client"

import { useEffect } from "react";

export function useRB2B() {
  useEffect(() => {
    const RB2B_ID = process.env.RB2B_ID;

    if (!RB2B_ID) {
      return;
    }

    // @ts-ignore
    !(function () {
      var reb2b = ((window as any).reb2b = (window as any).reb2b || []);
      if (reb2b.invoked) return;
      reb2b.invoked = true;
      reb2b.methods = ["identify", "collect"];
      reb2b.factory = function (method: any) {
        return function () {
          var args = Array.prototype.slice.call(arguments);
          args.unshift(method);
          reb2b.push(args);
          return reb2b;
        };
      };
      for (var i = 0; i < reb2b.methods.length; i++) {
        var key = reb2b.methods[i];
        reb2b[key] = reb2b.factory(key);
      }
      reb2b.load = function (key: any) {
        var script = document.createElement("script");
        script.type = "text/javascript";
        script.async = true;
        script.src =
          "https://s3-us-west-2.amazonaws.com/b2bjsstore/b/" +
          key +
          "/reb2b.js.gz";
        var first = document.getElementsByTagName("script")[0];
        first.parentNode?.insertBefore(script, first);
      };
      reb2b.SNIPPET_VERSION = "1.0.1";
      reb2b.load(RB2B_ID);
    })();
  }, []);
}
