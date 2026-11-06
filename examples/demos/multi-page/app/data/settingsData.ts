const fakeSettings = {
  record: "",

  async get(): Promise<string | null> {
    return fakeSettings.record || null;
  },

  async set(newAddress: string): Promise<string> {
    const newRecord = newAddress?.trim() || "";
    fakeSettings.record = newRecord;
    return newRecord;
  },
};

export async function getAddress() {
  return fakeSettings.get();
}

export async function setAddress(newAddress: string) {
  return fakeSettings.set(newAddress);
}
