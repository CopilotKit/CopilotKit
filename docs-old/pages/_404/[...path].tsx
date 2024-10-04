// This is needed for catch-all redirect of non existent rountes to the home page.
// https://github.com/vercel/next.js/discussions/16749#discussioncomment-2992732
export const Custom404 = () => <div></div>;

export const getServerSideProps = () => {
  return { redirect: { destination: "/", permanent: false } }; 
};

export default Custom404;