set -e 

pnpm changeset

pnpm changeset version

echo "Now push the changes to the remote repository and merge the PR to release"
