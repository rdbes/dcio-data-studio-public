(function (root) {
    "use strict";

    function bind(options) {
        const buttons = Array.from(
            options || []
        );
        const bindings = [];

        buttons.forEach(
            function (button, index) {
                function handleKeydown(event) {
                    let nextIndex = null;

                    if (
                        event.key === "ArrowRight"
                        || event.key === "ArrowDown"
                    ) {
                        nextIndex = (
                            (index + 1)
                            % buttons.length
                        );
                    } else if (
                        event.key === "ArrowLeft"
                        || event.key === "ArrowUp"
                    ) {
                        nextIndex = (
                            (
                                index - 1
                                + buttons.length
                            )
                            % buttons.length
                        );
                    } else if (
                        event.key === "Home"
                    ) {
                        nextIndex = 0;
                    } else if (
                        event.key === "End"
                    ) {
                        nextIndex = (
                            buttons.length - 1
                        );
                    }

                    if (nextIndex === null) {
                        return;
                    }

                    event.preventDefault();
                    buttons[nextIndex]?.focus();
                }

                button.addEventListener(
                    "keydown",
                    handleKeydown
                );

                bindings.push({
                    button: button,
                    handler: handleKeydown
                });
            }
        );

        return function unbind() {
            bindings.forEach(
                function (binding) {
                    binding.button
                        .removeEventListener(
                            "keydown",
                            binding.handler
                        );
                }
            );
        };
    }

    root.ADDMapKeyboardNavigation = (
        Object.freeze({
            bind: bind
        })
    );
}(
    typeof window !== "undefined"
        ? window
        : globalThis
));
