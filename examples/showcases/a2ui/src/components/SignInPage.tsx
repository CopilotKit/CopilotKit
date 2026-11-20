import { SignIn, SignUp } from "@clerk/tanstack-react-start";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "./BrandMark";

/**
 * Signing in is optional: the desk works signed out, with nothing kept. This
 * page is where a reader commits, to keep threads and connect apps. Clerk's
 * form sits flush in one of the desk's sheets, on the desk's paper.
 */
export function SignInPage({
  mode = "sign-in",
}: {
  mode?: "sign-in" | "sign-up";
}) {
  return (
    <main className="sign-in">
      <div className="sign-in__column">
        <a className="sign-in__brand" href="/">
          <BrandMark size={18} />
          A2UI Playground
        </a>
        <div className="sign-in__sheet" data-mode={mode}>
          <FormSkeleton mode={mode} />
          {mode === "sign-up" ? (
            <SignUp
              routing="path"
              path="/sign-up"
              signInUrl="/sign-in"
              fallbackRedirectUrl="/"
            />
          ) : (
            <SignIn
              routing="path"
              path="/sign-in"
              signUpUrl="/sign-up"
              fallbackRedirectUrl="/"
            />
          )}
        </div>
        <a className="sign-in__back" href="/">
          <ArrowLeft size={15} strokeWidth={1.75} aria-hidden />
          Back to the playground
        </a>
      </div>
    </main>
  );
}

/**
 * The form's shape while Clerk loads: the same blocks where Clerk's will be,
 * and the sheet held at the form's height (app.css), so nothing moves when
 * the real form arrives. CSS hides it as soon as Clerk renders.
 */
function FormSkeleton({ mode }: { mode: "sign-in" | "sign-up" }) {
  const fields = mode === "sign-up" ? 3 : 1;
  return (
    <div className="form-skeleton" role="status">
      <span className="visually-hidden">Loading sign-in</span>
      <div className="form-skeleton__card" aria-hidden>
        <div className="form-skeleton__header">
          <span className="form-skeleton__title" />
          <span className="form-skeleton__line" />
          <span className="form-skeleton__line form-skeleton__line--short" />
        </div>
        <div className="form-skeleton__social">
          <span className="form-skeleton__block" />
          <span className="form-skeleton__block" />
        </div>
        <span className="form-skeleton__divider" />
        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className="form-skeleton__field">
            <span className="form-skeleton__label" />
            <span className="form-skeleton__block" />
          </div>
        ))}
        <span className="form-skeleton__block form-skeleton__block--primary" />
      </div>
      <div className="form-skeleton__footer" aria-hidden>
        <span className="form-skeleton__line form-skeleton__line--short" />
      </div>
    </div>
  );
}
