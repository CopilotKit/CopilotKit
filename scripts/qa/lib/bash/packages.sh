#!/bin/bash

get_latest_versions() {
    local result="" # Initialize an empty string to hold the results

    for pkg in "$@"; do
        # Encode the package name for use in a URL
        encoded_pkg=$(echo "$pkg" | sed 's|/|%2F|g')
        
        # Fetch the latest version of the package
        latest_version=$(curl -s "https://registry.npmjs.org/$encoded_pkg" | jq -r '.["dist-tags"].latest')
        
        # Check if the latest version was found
        if [[ $latest_version != "null" && ! -z $latest_version ]]; then
            # Append the package and version to the result string, separated by '@' and spaces between packages
            result+="${pkg}@${latest_version} "
        else
            echo "Latest version for package ${pkg} could not be found." >&2
            return 1 # Optionally return an error code if a package's latest version can't be found
        fi
    done

    # Trim the trailing space and print the result
    echo "${result% }"
}

get_latest_copilotkit_versions() {
  get_latest_versions "@copilotkit/backend" "@copilotkit/react-core" "@copilotkit/react-textarea" "@copilotkit/react-ui" "@copilotkit/shared"
}

get_latest_prerelease_versions() {
    local result="" # Initialize an empty string to hold the results
    local tag_part="$1" # The specific part of the tag to match

    # Shift the arguments so $@ contains the packages
    shift

    for pkg in "$@"; do
        # Encode the package name for use in a URL
        encoded_pkg=$(echo "$pkg" | sed 's|/|%2F|g')
        
        # Fetch the list of all versions
        versions=$(curl -s "https://registry.npmjs.org/$encoded_pkg" | jq -r '.versions | keys[]')
        
        # Filter versions that match the tag part and get the last one
        latest_prerelease_version=$(echo "$versions" | grep "$tag_part" | tail -n 1)
        
        # Check if a version was found
        if [[ ! -z $latest_prerelease_version ]]; then
            # Append the package and version to the result string, separated by '@' and spaces between packages
            result+="${pkg}@${latest_prerelease_version} "
        else
            echo "Latest pre-release version matching '$tag_part' for package ${pkg} could not be found." >&2
        fi
    done

    # Trim the trailing space and print the result
    echo "${result% }"
}

get_latest_copilotkit_prerelase_versions() {
  get_latest_prerelease_versions $1 "@copilotkit/runtime" "@copilotkit/react-core" "@copilotkit/react-textarea" "@copilotkit/react-ui" "@copilotkit/shared"
}

use_local_packages() {
    echo "Building local packages..."
    pnpm -w freshbuild
    echo "Done building local packages."
    packages="file:$(pwd)/packages/runtime file:$(pwd)/packages/react-core file:$(pwd)/packages/react-textarea file:$(pwd)/packages/react-ui file:$(pwd)/packages/shared"
}

yarn_install_packages() {
    local app_path="$1"

    if [ -z "$packages" ]; then        
        use_local_packages;
    fi

    (cd "$app_path" && yarn add $packages)

    info "Package manager: yarn"
    info "Using CopilotKit packages: $packages"
}

npm_install_packages() {
    local app_path="$1"

    if [ -z "$packages" ]; then
        use_local_packages;
    fi

    (cd "$app_path" && npm install $packages --save)
    info "Package manager: npm"
    info "Using CopilotKit packages: $packages"
}
