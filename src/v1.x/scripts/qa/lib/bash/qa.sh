#!/bin/bash

# Get the current date in YYYY-MM-DD format
current_date=$(date +%Y-%m-%d)

# Define the file path with the current date
file_path="/tmp/qa-${current_date}.txt"

prompt() {
    local prompt="$1"
    local user_input

    while true; do
        # Display the prompt to the user and read a single character input
        read -p "$prompt (y/n): " -n 1 user_input
        echo # Move to a new line

        # Check the user input and append the prompt to the file with the appropriate emoji
        if [[ $user_input == "y" ]]; then
            echo -e "✅ $prompt" >> "$file_path" # Green checkmark emoji
            break
        elif [[ $user_input == "n" ]]; then
            echo -e "❌ $prompt" >> "$file_path" # Red X emoji
            break
        else
            echo "Invalid input. Please enter 'y' or 'n'."
        fi
    done
}

info() {
    local info_msg="$1"
    # Append the string to the file with the information emoji
    echo -e "📢 $info_msg" >> "$file_path"
}

fail() {
    local fail_msg="$1"
    # Append the string to the file with the information emoji
    echo -e "❌ $fail_msg" >> "$file_path"
}

succeed() {
    local success_msg="$1"
    # Append the string to the file with the information emoji
    echo -e "✅ $success_msg" >> "$file_path"
}
