
# save the current branch
current_branch=$(git branch --show-current)

# check if branch starts with "pre/"
suggested_tag=$(echo $current_branch | sed 's/_/-/g')

# replace all non-alphanumeric characters except hyphens
suggested_tag=$(echo $suggested_tag | sed 's/[^a-zA-Z0-9-]/-/g')

# chop leading and trailing hyphens
suggested_tag=$(echo $suggested_tag | sed 's/^-//;s/-$//')

# exit pre mode if already in pre mode
pnpm changeset pre exit

# version
pnpm changeset version --snapshot $suggested_tag --tag pr --no-git-tag

# publish
pnpm changeset publish --no-git-tag --snapshot $suggested_tag --tag pr --no-git-tag