import { Form, useLoaderData } from "@remix-run/react";
import type { ActionFunction } from "@remix-run/node";

import { getAddress, setAddress } from "~/data/settingsData";

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const newAddress = formData.get("address")?.toString() || "";
  await setAddress(newAddress);
  return newAddress;
};

export const loader = async () => {
  const address = await getAddress();

  return { address };
};

export default function Contact() {
  const { address } = useLoaderData<typeof loader>();

  return (
    <div id="settings">
      <Form method="post">
        <h4>Address</h4>
        <input name="address" defaultValue={address || ""} type="text" />
        <button type="submit">Save</button>
      </Form>
    </div>
  );
}
