export const getUser = (name: string) => {
  // imagine a database call here
  return {
    name: name,
    email: `${name}@example.com`,
    phone: "+1234567890",
    address: "123 Main St, Anytown, USA",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActive: new Date(),
    company: "Example Inc.",
    department: "Engineering",
    position: "Software Engineer",
    status: "active",
    notes: "This is a note about the user.",
  };
};

export const getUsers = () => {
  // imagine a database call here
  return [
    getUser("John Doe"),
    getUser("Jimmy Johnathan"),
    getUser("Michael Jersey"),
    getUser("Ronnie MacDonald"),
  ];
};