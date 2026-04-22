export function Greeting({ who = "world" }: { who?: string }) {
  return <h1>Hello, {who}</h1>;
}
export default Greeting;
