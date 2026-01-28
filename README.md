# mcbird-js

utility script for mcbird (required Node.js)

[English](README.md) / [日本語](README-jp.md)

## mcbird-js/nest.js

A converter to assist with nest data packs.

### Usage

```bash
node mcbird/nest.js <input_dir> <output_dir>
```

|Command-line argument|Meaning|
|:-|:-|
|input_dir|Data pack containing tests|
|output_dir|Destination for converted data pack for Nest|

### Example

Add the following comment at the beginning of each test case (mcfunction) in the data pack:

```mcfunction
#:unit <unit_name>
#:suite <suite_name>
#:case <case_name>
```

Note: \<unit_name>, \<suite_name>, \<case_name> must be written without quotes.
Strings that cannot omit quotes cannot be used (string must start with [half-width alphanumeric] or _).

Test cases are defined by their return values:

|Return Value|Action|
|:-|:-|
|0|Test continues|
|1|Test passes|
|-1|Test fails|

The test suite construction/teardown (mcfunction) within the data pack also requires the following comment at the top:

```mcfunction
#:unit <unit_name>
#:suite <suite_name>
#:setup or #:teardown
```

The test suite mechanism adds common setup and teardown for all test cases registered under \<suite_name>:

Test suites add common preprocessing and postprocessing for all test cases registered under \<suite_name>.

|Return Value|Action|
|:-|:-|
|fail|Test Failed|
|1|Test Passed|

This is the specification.

Under the current specification, you cannot register only test cases without specifying a test suite.

When registering a test case \<case_name> under test suite \<suite_name>,
you must provide a function (mcfunction) containing `#:setup` and `#:teardown` respectively.

If these are provided, mcbird/nest.js will convert them to:

```mcfunction
function nest:run {unit:\<unit_name>}
```

will execute tests for `<unit_name>`.

(Both the converted datapack and the nest datapack must be loaded for execution.)

### Convenient Features

```mcfunction
#:test ...(condition) assert ...(evaluation expression)
#:test ...(condition) deny ...(evaluation expression)
```

This comment is converted to

```mcfunction
execute ...(condition) unless ...(evaluation expression) run return run function nest:failex {...}
execute ...(condition) if ...(evaluation expression) run return run function nest:failex {...}
```

assert is an explicit statement that the evaluation expression must hold true; if it does not, the test fails.

deny is an explicit statement that the evaluation expression absolutely must not hold true; if it does, the test fails.

For test cases that should not reach the end of the function (assuming an intermediate return), if they do reach it,

```mcfunction
#:test failure
```

can be written to cause the test to fail at that point.

The advantage of using this special comment over the `function nest:fail` macro is that it embeds the filename and line number into the information during conversion.

The filename and line number are the most critical elements in a test case.

This makes locating the failure point far easier than manually crafting a message at the test failure location.

However, `#:test` is a simple replacement and does not perform syntax checks, so exercise extreme caution to avoid errors in its usage.

```mcfunction
execute ...(condition) if ...(evaluation expression) run say e
```

We recommend writing it like this first to confirm there are no syntax errors,
then rewrite it as:

```mcfunction
#:test ...(condition) assert/deny ...(evaluation expression)
```

before using it.

mcbird-js/bde2egg.js

mcbird/bde2egg.js by ricerabbitalk-enderman
Converts model data (directory or zip archive) output by BDEngine
into a data pack format usable by egg:animation.

### Usage

```bash
node mcbird/bde2egg.js <model_dir> <output_dir> [<chunk_size = 50>]
```

|Command Line Argument|Meaning|
|:-|:-|
|model_dir|Directory containing multiple model data files|
|output_dir|Directory to output the data pack|
|chunk_size|Data unit (number of frames) per file|

### Example

If model data exists as
<model_dir>/<model_name>.zip

it generates a data pack named
<output_dir>.

Model entities can be generated using the function tag:
```mcfunction
function #egg:bdengine/<model_name>
```

To facilitate entity discovery during initialization,
entities are summoned with the `__uninitialized` tag attached.

Always remove the `__uninitialized` tag after initialization.

Animation data is stored in:

```mcfunction
storage egg:bdengine <model_name>-<animation_name>
```

### Usage in egg

To use it in egg:

```mcfunction
# Generate the model.
function #egg:bdengine/<model_name>
# Enable the egg:model feature.
execute as @e[tag=__uninitialized] run function egg:model/-enable
# Enable the egg:animation feature.
execute as @e[tag=__uninitialized] run function egg:animation/-enable
# Set animation data.
data modify egg:animation/-set << {repeat:-1,path:<model_name>-<animation_name>}
execute as @e[tag=__uninitialized] run function egg:animation/-set
# Play animation.
execute as @e[tag=__uninitialized] run function egg:animation/-play
# Initialization complete.
tag @e[tag=__uninitialized] remove __uninitialized
```

A simplified macro version is also available.

This also generates with the `__uninitialized` tag applied, so once additional initialization is complete, remove it using `tag @e[tag=__uninitialized] remove __uninitialized`.

```mcfunction
# Create a model entity (without animation).
function egg:nog/macro/new_model {model:<model_name>}
# Create a model entity and animate it.
function egg:nog/macro/new_animation {repeat:-1,model:<model_name>,anime:<animation_name>}
# Apply animation to an existing model entity.
execteu as @e[...] run function egg:nog/macro/play_animation {repeat:-1,model:<model_name>,anime:<animation_name>}
```