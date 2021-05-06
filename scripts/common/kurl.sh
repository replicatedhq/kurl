# shellcheck disable=SC2148
# no shebang as this is a composite script

function kurl_init_config() {
    if kubernetes_resource_exists kurl configmap kurl-current-config; then
        kubectl delete configmap -n kurl kurl-last-config || true
        kubectl get configmap -n kurl -o json kurl-current-config | sed 's/kurl-current-config/kurl-last-config/g' | kubectl apply -f -
        kubectl delete configmap -n kurl kurl-current-config || true
    else
        kubectl create configmap -n kurl kurl-last-config
    fi

    kubectl create configmap -n kurl kurl-current-config

    kurl_set_current_version
}

function kurl_set_current_version() {
    if [ -z "${KURL_VERSION}" ]; then
        return
    fi
    kubectl patch configmaps -n kurl kurl-current-config --type merge -p "{\"data\":{\"kurl-version\":\"${KURL_VERSION}\"}}"
}

function kurl_get_current_version() {
    kubectl get configmap -n kurl kurl-current-config -o jsonpath="{.data.kurl-version}"
}
