#!/bin/bash

set -euo pipefail

# Populate VERSIONS array with 1.20+ and 1.19 and 1.18 latest versions available
VERSIONS=()
function find_available_versions() {
    docker build -t k8s - < Dockerfile
    VERSIONS=($(docker run k8s apt list -a kubelet 2>/dev/null | grep -Eo '1\.[2-9][0-9]\.[0-9]+' | sort -rV | uniq))
    echo "Found ${#VERSIONS[*]} versions for Kubernetes 1.20+: ${VERSIONS[*]}"

    local versions119=($(docker run k8s apt list -a kubelet 2>/dev/null | grep -Eo '1\.19\.[0-9]+' | sort -rV | uniq))
    if [ ${#versions119[@]} -gt 0 ]; then
        echo "Found latest version for Kubernetes 1.19: ${versions119[0]}"
        VERSIONS+=("${versions119[0]}")
    fi

    local versions118=($(docker run k8s apt list -a kubelet 2>/dev/null | grep -Eo '1\.18\.[0-9]+' | sort -rV | uniq))
    if [ ${#versions118[@]} -gt 0 ]; then
        echo "Found latest version for Kubernetes 1.18: ${versions118[0]}"
        VERSIONS+=("${versions118[0]}")
    fi

    echo "Found ${#VERSIONS[*]} versions for Kubernetes: ${VERSIONS[*]}"
}

function generate_version_directory() {
    local version="$1"

    mkdir -p "../$version"
    rm -f "../$version/Manifest"

    curl -LO https://dl.k8s.io/release/v${version}/bin/linux/amd64/kubeadm
    chmod +x kubeadm
    mv kubeadm /tmp

    while read -r image; do
        # k8s.gcr.io/kube-apiserver:v1.20.2 -> kube-apiserver
        local name=$(echo "$image" | awk -F':' '{ print $1 }' | awk -F '/' '{ print $2 }')
        echo "image ${name} ${image}" >> "../$version/Manifest"
    done < <(/tmp/kubeadm config images list --kubernetes-version=${version})

    # add conformance image for sonobuoy to manifest
    echo "image conformance k8s.gcr.io/conformance:v${version}" >> "../$version/Manifest"

    local criToolsVersion=$(curl -Ls -m 60 -o /dev/null -w %{url_effective} https://github.com/kubernetes-sigs/cri-tools/releases/latest | xargs basename)

    echo "" >> "../$version/Manifest"
    echo "asset kubeadm https://storage.googleapis.com/kubernetes-release/release/v$version/bin/linux/amd64/kubeadm" >> "../$version/Manifest"
    echo "asset crictl-linux-amd64.tar.gz https://github.com/kubernetes-sigs/cri-tools/releases/download/$criToolsVersion/crictl-$criToolsVersion-linux-amd64.tar.gz" >> "../$version/Manifest"

    echo "" >> "../$version/Manifest"
    echo "asset kustomize-v2.0.3 https://github.com/kubernetes-sigs/kustomize/releases/download/v2.0.3/kustomize_2.0.3_linux_amd64" >> "../$version/Manifest"
    echo "asset kustomize-v3.5.4.tar.gz https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2Fv3.5.4/kustomize_v3.5.4_linux_amd64.tar.gz" >> "../$version/Manifest"
}

function update_available_versions() {
    local versions120=( $( for i in "${VERSIONS[@]}" ; do echo $i ; done | grep '^1.2' ) )
    sed -i "/cron-kubernetes-update-120/c\    \"$(echo ${versions120[*]} | sed 's/ /", "/g')\", \/\/ cron-kubernetes-update-120" ../../../web/src/installers/versions.js

    local version119=( $( for i in "${VERSIONS[@]}" ; do echo $i ; done | grep '^1.19' ) )
    if ! sed '0,/cron-kubernetes-update-119/d' ../../../web/src/installers/versions.js | sed '/\],/,$d' | grep -q "${version119}" ; then
        sed -i "/cron-kubernetes-update-119/a\    \"${version119}\"\," ../../../web/src/installers/versions.js
    fi

    local version118=( $( for i in "${VERSIONS[@]}" ; do echo $i ; done | grep '^1.18' ) )
    if ! sed '0,/cron-kubernetes-update-118/d' ../../../web/src/installers/versions.js | sed '/\],/,$d' | grep -q "${version118}" ; then
        sed -i "/cron-kubernetes-update-118/a\    \"${version118}\"\," ../../../web/src/installers/versions.js
    fi
}

function main() {
    find_available_versions

    for version in ${VERSIONS[*]}; do
        generate_version_directory "$version"
    done
    echo "::set-output name=kubernetes_version::${VERSIONS[*]}"

    update_available_versions
}

main
