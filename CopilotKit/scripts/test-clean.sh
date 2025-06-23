#!/bin/bash

# CopilotKit Clean Test Runner
# Runs tests with clean output, table summary, and coverage

echo "🧪 Running CopilotKit Tests"
echo "============================"
echo ""

# Store test results with detailed info (using arrays and parallel indexing)
TEST_PACKAGES=()
TEST_STATUS=()
TEST_SUITES=()
TEST_COUNT=()
TEST_TIME=()
TEST_COVERAGE=()
FAILED_PACKAGES=()

# Get all packages with tests
PACKAGES=($(pnpm list --depth -1 --json | jq -r '.[] | select(.path | contains("packages")) | .name' 2>/dev/null || echo ""))

# Fallback to manual package discovery if jq fails
if [ ${#PACKAGES[@]} -eq 0 ]; then
    PACKAGES=(
        "@copilotkit/react-core"
        "@copilotkit/react-ui"
        "@copilotkit/react-textarea"
        "@copilotkit/runtime"
        "@copilotkit/runtime-client-gql"
        "@copilotkit/sdk-js"
        "@copilotkit/shared"
    )
fi

echo "📦 Testing ${#PACKAGES[@]} packages..."
echo ""

# Build first (suppressed output)
echo "🔨 Building packages..."
pnpm turbo build --output-logs=errors-only >/dev/null 2>&1
BUILD_EXIT_CODE=$?

if [ $BUILD_EXIT_CODE -ne 0 ]; then
    echo "❌ Build failed. Running with output:"
    pnpm turbo build
    exit $BUILD_EXIT_CODE
fi

echo "✅ Build completed successfully"
echo ""

# Function to extract Jest stats and store in arrays
extract_jest_stats() {
    local output="$1"
    local package="$2"
    
    # Extract test suites
    SUITES=$(echo "$output" | grep "Test Suites:" | sed 's/.*Test Suites: \([0-9]*\) passed.*/\1/' | head -1)
    if [ -z "$SUITES" ]; then SUITES="N/A"; fi
    
    # Extract test count
    TESTS=$(echo "$output" | grep "Tests:" | sed 's/.*Tests: *\([0-9]*\) passed.*/\1/' | head -1)
    if [ -z "$TESTS" ]; then TESTS="N/A"; fi
    
    # Extract time
    TIME=$(echo "$output" | grep "Time:" | sed 's/.*Time: *\([0-9.]*[a-z]*\).*/\1/' | head -1)
    if [ -z "$TIME" ]; then TIME="N/A"; fi
    
    # Extract coverage if available (try multiple patterns)
    COVERAGE=$(echo "$output" | grep -E "All files.*[0-9]+\.[0-9]+%" | sed 's/.*\([0-9]*\.[0-9]*%\).*/\1/' | head -1)
    if [ -z "$COVERAGE" ]; then
        # Try Coverage summary format: "Lines        : 85.71% ( 6/7 )"
        COVERAGE=$(echo "$output" | grep -E "Lines.*[0-9]+\.[0-9]+%" | sed 's/.*Lines.*: *\([0-9]*\.[0-9]*%\).*/\1/' | head -1)
    fi
    if [ -z "$COVERAGE" ]; then 
        # Try simple percentage pattern anywhere in output
        COVERAGE=$(echo "$output" | grep -o "[0-9]*\.[0-9]*%" | head -1)
    fi
    if [ -z "$COVERAGE" ]; then COVERAGE="N/A"; fi
    
    # Store in arrays
    TEST_PACKAGES+=("$package")
    TEST_SUITES+=("$SUITES")
    TEST_COUNT+=("$TESTS")
    TEST_TIME+=("$TIME")
    TEST_COVERAGE+=("$COVERAGE")
}

# Run tests for each package
for package in "${PACKAGES[@]}"; do
    echo "🧪 Testing $package..."
    
    # Run test and capture output  
    # First try with Jest coverage using the double-dash syntax
    TEST_OUTPUT=$(pnpm -F "$package" test -- --coverage --coverageReporters=text-summary 2>&1)
    TEST_EXIT_CODE=$?
    
    # If that fails, try without coverage
    if [ $TEST_EXIT_CODE -ne 0 ]; then
        TEST_OUTPUT=$(pnpm -F "$package" test 2>&1)
        TEST_EXIT_CODE=$?
    fi
    
    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo "✅ $package"
        TEST_STATUS+=("PASS")
        extract_jest_stats "$TEST_OUTPUT" "$package"
    else
        echo "❌ $package - FAILED"
        TEST_STATUS+=("FAIL")
        extract_jest_stats "$TEST_OUTPUT" "$package"
        FAILED_PACKAGES+=("$package")
        
        # Show error details for failed tests
        echo "   Error details:"
        echo "$TEST_OUTPUT" | grep -E "(FAIL|Error:|✕|●)" | head -5 | sed 's/^/   /'
    fi
    echo ""
done

# Display results table
echo "📊 Test Results Summary"
echo "======================="
echo ""

# Calculate column widths
MAX_PKG_WIDTH=0
for package in "${TEST_PACKAGES[@]}"; do
    if [ ${#package} -gt $MAX_PKG_WIDTH ]; then
        MAX_PKG_WIDTH=${#package}
    fi
done

# Ensure minimum width
if [ $MAX_PKG_WIDTH -lt 25 ]; then
    MAX_PKG_WIDTH=25
fi

# Table header
printf "%-${MAX_PKG_WIDTH}s | %-8s | %-7s | %-6s | %-8s | %-9s\n" "Package" "Status" "Suites" "Tests" "Time" "Coverage"
printf "%s\n" "$(printf '%.0s-' $(seq 1 $(($MAX_PKG_WIDTH + 50))))"

# Table rows
for i in "${!TEST_PACKAGES[@]}"; do
    package="${TEST_PACKAGES[$i]}"
    status="${TEST_STATUS[$i]}"
    suites="${TEST_SUITES[$i]}"
    tests="${TEST_COUNT[$i]}"
    time="${TEST_TIME[$i]}"
    coverage="${TEST_COVERAGE[$i]}"
    
    printf "%-${MAX_PKG_WIDTH}s | %-8s | %-7s | %-6s | %-8s | %-9s\n" \
        "$package" \
        "$status" \
        "$suites" \
        "$tests" \
        "$time" \
        "$coverage"
done

echo ""

# Coverage Summary
echo "📈 Coverage Summary"
echo "==================="
echo ""

TOTAL_COVERAGE=0
COVERAGE_COUNT=0

for i in "${!TEST_PACKAGES[@]}"; do
    package="${TEST_PACKAGES[$i]}"
    coverage="${TEST_COVERAGE[$i]}"
    if [ "$coverage" != "N/A" ]; then
        echo "📦 $package: $coverage"
        # Extract numeric value for averaging
        numeric_coverage=$(echo "$coverage" | sed 's/%//')
        if [[ "$numeric_coverage" =~ ^[0-9]*\.?[0-9]+$ ]]; then
            TOTAL_COVERAGE=$(echo "$TOTAL_COVERAGE + $numeric_coverage" | bc -l 2>/dev/null || echo "$TOTAL_COVERAGE")
            COVERAGE_COUNT=$((COVERAGE_COUNT + 1))
        fi
    fi
done

if [ $COVERAGE_COUNT -gt 0 ]; then
    AVG_COVERAGE=$(echo "scale=1; $TOTAL_COVERAGE / $COVERAGE_COUNT" | bc -l 2>/dev/null || echo "N/A")
    echo ""
    echo "📊 Average Coverage: ${AVG_COVERAGE}%"
fi

echo ""

# Final summary
if [ ${#FAILED_PACKAGES[@]} -eq 0 ]; then
    echo "🎉 All tests passed!"
    exit 0
else
    echo "💥 ${#FAILED_PACKAGES[@]} package(s) failed:"
    for package in "${FAILED_PACKAGES[@]}"; do
        echo "   - $package"
    done
    exit 1
fi
