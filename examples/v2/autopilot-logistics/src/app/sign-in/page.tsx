import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listDemoAccounts } from "@/lib/db";

export default async function SignInPage() {
  if (await currentUser()) redirect("/");
  const accounts = listDemoAccounts();
  return (
    <main className="sign-in" data-copilot-private>
      <div className="sign-in-card">
        <div className="brand">
          <span className="brand-mark">N</span>
          <span>
            Northstar
            <br />
            <small>LOGISTICS</small>
          </span>
        </div>
        <h1>Choose a demo account</h1>
        <p>
          This local prototype uses fixed fictional accounts. Each role sees its
          own organization's data.
        </p>
        <div className="account-options">
          {accounts.map((account) => (
            <form key={account.id} action="/api/session" method="post">
              <input type="hidden" name="account" value={account.id} />
              <button type="submit">
                <strong>{account.displayName}</strong>
                <span>
                  {account.role} · {account.organizationName}
                </span>
              </button>
            </form>
          ))}
        </div>
      </div>
    </main>
  );
}
