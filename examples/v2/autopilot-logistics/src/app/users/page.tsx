import { requireUser } from "@/lib/auth";
import { listUsers } from "@/lib/db";
import { UserForm } from "@/components/UserForms";

export default async function UsersPage() {
  const user = await requireUser();
  const people = listUsers(user).map((person) => ({ ...person }));
  return (
    <>
      <div className="page-heading">
        <div>
          <small>WORKSPACE</small>
          <h1>Users</h1>
          <p>People in {user.organizationName}.</p>
        </div>
      </div>
      {user.role === "admin" && (
        <section className="card user-card">
          <h2>Add a user</h2>
          <UserForm />
        </section>
      )}
      <section className="card user-card">
        <h2>Team</h2>
        {people.map((person) => (
          <div className="user-row" key={person.id}>
            <div>
              <strong>{person.display_name}</strong>
              <small>
                {person.active ? person.role : `inactive · ${person.role}`}
              </small>
            </div>
            {user.role === "admin" && person.active === 1 && (
              <UserForm person={person} />
            )}
          </div>
        ))}
      </section>
    </>
  );
}
