#!/bin/bash

# Function to find the latest version folder
find_latest_version() {
    # Find all folders matching the pattern v[0-9][0-9][0-9]
    # Sort them numerically and get the last one
    latest=$(ls -d v[0-9][0-9][0-9] 2>/dev/null | sort -n | tail -n 1)
    
    if [ -z "$latest" ]; then
        echo "Error: No version folders found"
        exit 1
    else
        echo "$latest"
    fi
}

# Get the latest version
latest_version=$(find_latest_version)

# Check if the latest version folder exists
if [ ! -d "$latest_version" ]; then
    echo "Error: Latest version folder '$latest_version' not found"
    exit 1
fi

# Remove latest-bak if it exists
if [ -d "latest-bak" ]; then
    echo "Removing existing latest-bak folder"
    rm -rf "latest-bak"
fi

# Move latest to latest-bak if it exists
if [ -d "latest" ]; then
    echo "Moving current latest to latest-bak"
    mv "latest" "latest-bak"
fi

# Create new latest folder and copy contents
echo "Creating new latest folder from $latest_version"
cp -R "$latest_version" "latest"

echo "Successfully updated latest folder from $latest_version"