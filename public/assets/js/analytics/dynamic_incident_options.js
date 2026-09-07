(function (root, factory) {
    "use strict";

    const api = factory();

    if (
        typeof module === "object"
        && module.exports
    ) {
        module.exports = api;
        return;
    }

    root.ADDDynamicIncidentOptions = Object.freeze(
        api
    );
})(
    typeof globalThis !== "undefined"
        ? globalThis
        : this,
    function () {
        "use strict";

        function buildParameters(
            form,
            FormDataCtor
        ) {
            const parameters = new URLSearchParams();

            if (!form) {
                return parameters;
            }

            const FormDataImplementation = (
                FormDataCtor
                || (
                    typeof FormData !== "undefined"
                        ? FormData
                        : null
                )
            );

            if (!FormDataImplementation) {
                throw new TypeError(
                    "FormData implementation is required."
                );
            }

            const formData = new FormDataImplementation(
                form
            );

            formData.forEach(function (value, key) {
                if (
                    key === "incident"
                    || key === "csrfmiddlewaretoken"
                ) {
                    return;
                }

                parameters.append(
                    key,
                    value
                );
            });

            return parameters;
        }

        async function requestOptions({
            endpoint,
            form,
            signal,
            fetchImpl,
            FormDataCtor,
        }) {
            if (!endpoint || !form) {
                return {
                    options: [],
                    signature: "",
                };
            }

            if (typeof fetchImpl !== "function") {
                throw new TypeError(
                    "Fetch implementation is required."
                );
            }

            const parameters = buildParameters(
                form,
                FormDataCtor
            );
            const signature = parameters.toString();

            const response = await fetchImpl(
                endpoint
                + (
                    signature
                        ? `?${signature}`
                        : ""
                ),
                {
                    method: "GET",
                    headers: {
                        Accept: "application/json",
                    },
                    signal,
                }
            );

            if (!response.ok) {
                throw new Error(
                    "Incident options request failed "
                    + `with HTTP ${response.status}.`
                );
            }

            const payload = await response.json();

            return {
                options: Array.isArray(payload.options)
                    ? payload.options
                    : [],
                signature,
            };
        }

        return {
            buildParameters,
            requestOptions,
        };
    }
);
