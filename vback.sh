#!/bin/bash

# Function to find the latest version folder
find_latest_version() {
    # Find all folders matching the pattern v[0-9][0-9][0-9]
    # Sort them numerically and get the last one
    latest=$(ls -d v[0-9][0-9][0-9] 2>/dev/null | sort -n | tail -n 1)
    
    if [ -z "$latest" ]; then
        # If no version folders exist, start with v000
        echo "v000"
    else
        echo "$latest"
    fi
}

# Check if "latest" folder exists
if [ ! -d "latest" ]; then
    echo "Error: 'latest' folder not found"
    exit 1
fi

# Get the latest version
latest_version=$(find_latest_version)

if [ "$latest_version" = "v000" ]; then
    # If no version exists, create v001
    new_version="v001"
else
    # Extract the number from the latest version and increment it
    current_num=${latest_version#v}  # Remove the 'v' prefix
    next_num=$(printf "%03d" $((10#$current_num + 1)))  # Increment and pad with zeros
    new_version="v$next_num"
fi

# Create the new version by copying from "latest"
echo "Creating $new_version from latest folder"
cp -R "latest" "$new_version"

echo "Successfully created $new_version"