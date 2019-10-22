import * as crypto from "crypto";
import * as yaml from "js-yaml";
import * as _ from "lodash";
import * as mysql from "promise-mysql";
import { Service } from "ts-express-decorators";
import * as request from "request-promise";
import * as AJV from "ajv";
import { MysqlWrapper } from "../util/services/mysql";
import { instrumented } from "monkit";
import { logger } from "../logger";
import { Forbidden } from "../server/errors";

interface ErrorResponse {
  error: any;
}

export interface KubernetesConfig {
  version: string;
  serviceCIDR?: string;
}

const kubernetesConfigSchema = {
  type: "object",
  properties: {
    version: { type: "string" },
    serviceCIDR: { type: "string" },
  },
  required: [ "version" ],
  additionalProperties: false,
};

export interface DockerConfig {
  version: string;
  bypassStorageDriverWarnings?: boolean;
  hardFailOnLoopback?: boolean;
  noCEOnEE?: boolean;
}

const dockerConfigSchema = {
  type: "object",
  properties: {
    version: { type: "string" },
    bypassStorageDriverWarnings: { type: "boolean" },
    hardFailOnLoopback: { type: "boolean" },
    noCEOnEE: { type: "boolean" },
  },
  required: [ "version" ],
  additionalProperites: false,
};

export interface WeaveConfig {
  version: string;
  IPAllocRange?: string;
  encryptNetwork?: boolean;
}

const weaveConfigSchema = {
  type: "object",
  properties: {
    version: { type: "string" },
    IPAllocRange: { type: "string" },
    encryptNetwork: { type: "boolean" },
  },
  required: [ "version" ],
  additionalProperites: false,
}

export interface RookConfig {
  version: string;
  storageClass?: string;
  cephPoolReplicas?: number;
}

const rookConfigSchema = {
  type: "object",
  properties: {
    version: { type: "string" },
    storageClass: { type: "string" },
    cephPoolReplicas: { type: "number" },
  },
  required: [ "version" ],
  additionalProperites: false,
};

export interface ContourConfig {
  version: string;
}

const contourConfigSchema = {
  type: "object",
  properties: {
    version: { type: "string" },
  },
  required: ["version"],
  additionalProperties: false,
};

export interface RegistryConfig {
  version: string;
}

const registryConfigSchema = {
  type: "object",
  properties: {
    version: { type: "string" },
  },
  required: ["version"],
  additionalProperties: false,
};

export interface PrometheusConfig {
  version: string;
}

const prometheusConfigSchema = {
  type: "object",
  properties: {
    version: { type: "string" },
  },
  required: ["version"],
  additionalProperties: false,
};

export interface KotsadmConfig {
  version: string;
  applicationSlug?: string;
  uiBindPort?: number;
}

const kotsadmConfigSchema = {
  type: "object",
  properties: {
    version: { type: "string" },
    applicationSlug: { type: "string" },
    uiBindPort: { type: "number" },
  },
  required: ["version"],
  additionalProperties: false,
};

export interface InstallerSpec {
  kubernetes: KubernetesConfig;
  docker?: DockerConfig;
  weave?: WeaveConfig;
  rook?: RookConfig;
  contour?: ContourConfig;
  registry?: RegistryConfig;
  prometheus?: PrometheusConfig;
  kotsadm?: KotsadmConfig;
}

const specSchema = {
  type: "object",
  properties: {
    // order here determines order in rendered yaml
    kubernetes: kubernetesConfigSchema,
    docker: dockerConfigSchema,
    weave: weaveConfigSchema,
    rook: rookConfigSchema,
    contour: contourConfigSchema,
    registry: registryConfigSchema,
    kotsadm: kotsadmConfigSchema,
  },
  required: ["kubernetes"],
  additionalProperites: false,
};

export interface ObjectMeta {
  name: string
}

export interface InstallerObject {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: InstallerSpec;
}

export class Installer {

  public id: string;
  public spec: InstallerSpec;

  constructor(
    public readonly teamID?: string,
  ) {
    this.spec = {
      kubernetes: { version: "" },
    };
  }

  public clone(): Installer {
    const i = new Installer();

    i.id = this.id;
    i.spec = _.cloneDeep(this.spec);

    return i;
  }

  // Going forward new fields are automatically included in the hash after being sorted
  // alphabetically but the arbitrary order must be preserved for legacy fields.
  public hash(): string {
    const h = crypto.createHash('sha256');

    if (this.spec.kubernetes && this.spec.kubernetes.version) {
      h.update(`kubernetes_version=${this.spec.kubernetes.version}`);
    }
    if (this.spec.weave && this.spec.weave.version) {
      h.update(`weave_version=${this.spec.weave.version}`);
    }
    if (this.spec.rook && this.spec.rook.version) {
      h.update(`rook_version=${this.spec.rook.version}`);
    }
    if (this.spec.contour && this.spec.contour.version) {
      h.update(`contour_version=${this.spec.contour.version}`);
    }
    if (this.spec.registry && this.spec.registry.version) {
      h.update(`registry_version=${this.spec.registry.version}`);
    }
    if (this.spec.kotsadm && this.spec.kotsadm.version) {
      h.update(`kotsadm_version=${this.spec.kotsadm.version}`);
    }
    if (this.spec.kotsadm && this.spec.kotsadm.applicationSlug) {
      h.update(`kotsadm_applicationSlug=${this.spec.kotsadm.applicationSlug}`);
    }

    const legacy = {
      kubernetes_version: true,
      weave_version: true,
      rook_version: true,
      contour_version: true,
      registry_version: true,
      kotsadm_version: true,
      kotsadm_applicationSlug: true,
    };
    const fields: Array<string> = [];
    _.each(_.keys(this.spec), (config) => {
      _.each(_.keys(this.spec[config]), (field) => {
        const val = this.spec[config][field];
        const fieldKey = `${config}_${field}`;

        if (_.isUndefined(val)) {
          return;
        }
        if (legacy[fieldKey]) {
          return;
        }

        fields.push(`${fieldKey}=${val}`);
      });
    });

    _.each(fields.sort(), (field) => {
      h.update(field);
    });

    return h.digest('hex').substring(0,7);
  }

  // Return an ordered list of all addon fields in the spec.
  static specPaths(): Array<string> {
    const paths: Array<string> = [];

    _.each(specSchema.properties, (configSchema, configName) => {
      _.each(configSchema.properties, (val, field) => {
        paths.push(`${configName}.${field}`);
      });
    });

    return paths;
  }

  // returned installer must be validated before use
  static parse(doc: string, teamID?: string): Installer {
    const parsed = yaml.safeLoad(doc);

    const i = new Installer(teamID);
    i.id = _.get(parsed, "metadata.name", "");

    if (!_.isPlainObject(parsed)) {
      return i;
    }

    if (parsed.apiVersion === "kurl.sh/v1beta1") {
      return Installer.parseV1Beta1(doc, teamID);
    }

    if (!parsed.spec || !_.isPlainObject(parsed.spec)) {
      return i;
    }
    // ensure that items are added to spec in fixed order so rendered yaml is ordered
    _.each(Installer.specPaths(), (path) => {
      const val = _.get(parsed.spec, path);

      if (_.isUndefined(val)) {
        return;
      }

      _.set(i.spec, path, val);
    });

    return i;
  }

  static parseV1Beta1(doc: string, teamID?: string): Installer {
    const parsed = yaml.safeLoad(doc);

    const i = new Installer(teamID);
    i.id = _.get(parsed, "metadata.name", "");

    if (!_.isPlainObject(parsed)) {
      return i.migrateV1Beta1ToV1Beta2();
    }
    i.spec.kubernetes.version = _.get(parsed.spec, "kubernetes.version", "");

    const weaveVersion = _.get(parsed.spec, "weave.version");
    const rookVersion = _.get(parsed.spec, "rook.version");
    const contourVersion = _.get(parsed.spec, "contour.version");
    const registryVersion = _.get(parsed.spec, "registry.version");
    const kotsadmVersion = _.get(parsed.spec, "kotsadm.version");
    const kotsadmApplicationSlug = _.get(parsed.spec, "kotsadm.applicationSlug");

    if (weaveVersion) {
      i.spec.weave = { version: weaveVersion };
    }
    if (rookVersion) {
      i.spec.rook = { version: rookVersion };
    }
    if (contourVersion) {
      i.spec.contour = { version: contourVersion };
    }
    if (registryVersion) {
      i.spec.registry = { version: registryVersion };
    }
    if (kotsadmVersion) {
      i.spec.kotsadm = { version: kotsadmVersion };
      if (kotsadmApplicationSlug) {
        i.spec.kotsadm.applicationSlug = kotsadmApplicationSlug;
      }
    }

    return i.migrateV1Beta1ToV1Beta2();
  }

  // v1beta1 had no config for Docker because it was always included
  // Note this causes the hash to change.
  public migrateV1Beta1ToV1Beta2(): Installer {
    const i = this.clone();
    i.spec.docker = { version: "latest" };

    return i;
  }

  public toYAML(): string {
    return yaml.safeDump(this.toObject());
  }

  public toObject(): InstallerObject {
    const obj = {
      apiVersion: "kurl.sh/v1beta2",
      kind: "Installer",
      metadata: {
        name: `${this.id}`,
      },
      spec: { kubernetes: _.cloneDeep(this.spec.kubernetes) },
    };

    // add spec properties in order they should be rendered in yaml
    _.each(specSchema.properties, (val, key) => {
      if (this.spec[key]) {
        obj.spec[key] = _.cloneDeep(this.spec[key]);
      }
    });

    return obj;
  }

  // first version of each is "latest"
  static versions = {
    kubernetes: [
      "1.15.3",
      "1.15.2",
      "1.15.1",
      "1.15.0",
    ],
    docker: [
      "18.09.8",
    ],
    weave: [
      "2.5.2",
    ],
    rook: [
      "1.0.4",
    ],
    contour: [
      "0.14.0",
    ],
    registry: [
      "2.7.1",
    ],
    prometheus: [
      "0.33.0",
    ],
    kotsadm: [
      "0.9.9",
    ],
  }

  static latest(): Installer {
    const i = new Installer();

    i.id = "latest";
    i.spec.kubernetes = { version: "latest" };
    i.spec.weave = { version: "latest" };
    i.spec.rook = { version: "latest" };
    i.spec.contour = { version: "latest" };
    i.spec.registry = { version: "latest" };
    i.spec.prometheus = { version: "latest" };

    return i;
  }

  public resolve(): Installer {
    const i = this.clone();

    _.each(_.keys(i.spec), (config) => {
      if (i.spec[config].version === "latest") {
        i.spec[config].version = _.first(Installer.versions[config]);
      }
    });

    return i;
  }

  static hasVersion(config: string, version: string): boolean {
    if (version === "latest") {
      return true;
    }
    if (_.includes(Installer.versions[config], version)) {
      return true;
    }
    return false;
  }

  public validate(): ErrorResponse|undefined {
    if (!this.spec || !this.spec.kubernetes || !this.spec.kubernetes.version) {
        return { error: { message: "Kubernetes version is required" } };
    }

    const ajv = new AJV();
    const validate = ajv.compile(specSchema);
    const valid = validate(this.spec);

    if (!valid && validate.errors && validate.errors.length) {
      const err = validate.errors[0];
      const message = `spec${err.dataPath} ${err.message}`;
      return { error: { message } };
    }

    if (!Installer.hasVersion("kubernetes", this.spec.kubernetes.version)) {
      return { error: { message: `Kubernetes version ${_.escape(this.spec.kubernetes.version)} is not supported` } };
    }
    if (this.spec.weave && !Installer.hasVersion("weave", this.spec.weave.version)) {
      return { error: { message: `Weave version "${_.escape(this.spec.weave.version)}" is not supported` } };
    }
    if (this.spec.rook && !Installer.hasVersion("rook", this.spec.rook.version)) {
      return { error: { message: `Rook version "${_.escape(this.spec.rook.version)}" is not supported` } };
    }
    if (this.spec.contour && !Installer.hasVersion("contour", this.spec.contour.version)) {
      return { error: { message: `Contour version "${_.escape(this.spec.contour.version)}" is not supported` } };
    }
    if (this.spec.registry && !Installer.hasVersion("registry", this.spec.registry.version)) {
      return { error: { message: `Registry version "${_.escape(this.spec.registry.version)}" is not supported` } };
    }
    if (this.spec.kotsadm) {
      if (!Installer.hasVersion("kotsadm", this.spec.kotsadm.version)) {
        return { error: { message: `Kotsadm version "${_.escape(this.spec.kotsadm.version)}" is not supported` } };
      }
    }
  }

  public packages(): Array<string> {
    const i = this.resolve();

    const pkgs = [ "common" ];

    _.each(_.keys(this.spec), (config: string) => {
      pkgs.push(`${config}-${this.spec[config].version}`);
    });

    return pkgs;
  }

  public isLatest(): boolean {
    return _.isEqual(this.spec, {
      kubernetes: { version: "latest" },
      docker: { version: "latest" },
      weave: { version: "latest" },
      rook: { version: "latest" },
      contour: { version: "latest" },
      registry: { version: "latest" },
    });
  }

  static isSHA(id: string): boolean {
    return /^[0-9a-f]{7}$/.test(id); 
  }

  static isValidSlug(id: string): boolean {
    return /^[0-9a-zA-Z-_]{1,255}$/.test(id);
  }

  static slugIsReserved(id: string): boolean {
    return _.includes([
      "latest",
      "beta",
      "stable",
      "unstable",
      "healthz",
      "dist",
      "installer",
      "bundle",
      "versions",
    ], _.lowerCase(id));
  }
}

@Service()
export class InstallerStore {
  private readonly pool: mysql.Pool;

  constructor({ pool }: MysqlWrapper) {
    this.pool = pool;
  }

  @instrumented
  public async getInstaller(installerID: string): Promise<Installer|undefined> {
    if (installerID === "latest") {
      return Installer.latest();
    }

    const q = "SELECT yaml, team_id FROM kurl_installer WHERE kurl_installer_id = ?";
    const v = [installerID];
    const results = await this.pool.query(q, v);

    if (results.length === 0) {
      return;
    }

    let i = Installer.parse(results[0].yaml, results[0].team_id);

    i.id = installerID;
    return i;
  }

  @instrumented
  public async saveAnonymousInstaller(installer: Installer): Promise<void> {
    if (!installer.id) {
      throw new Error("Installer ID is required");
    }
    if (installer.teamID) {
      throw new Error("Anonymous installers must not have team ID");
    }
    if (!Installer.isSHA(installer.id)) {
      throw new Error("Anonymous installers must have generated ID");
    }

    const q = "INSERT IGNORE INTO kurl_installer (kurl_installer_id, yaml) VALUES (?, ?)";
    const v = [installer.id, installer.toYAML()];

    await this.pool.query(q, v);
  }

  @instrumented
  public async saveTeamInstaller(installer: Installer): Promise<void> {
    if (!installer.id) {
      throw new Error("Installer ID is required");
    }
    if (!installer.teamID) {
      throw new Error("Team installers must have team ID");
    }
    if (Installer.isSHA(installer.id)) {
      throw new Error("Team installers must not have generated ID");
    }

    const conn = await this.pool.getConnection();
    await conn.beginTransaction({sql: "", timeout: 10000});

    try {
      const qInsert = "INSERT IGNORE INTO kurl_installer (kurl_installer_id, yaml, team_id) VALUES (?, ?, ?)";
      const vInsert = [installer.id, installer.toYAML(), installer.teamID];

      const resultsInsert = await conn.query(qInsert, vInsert);

      if (resultsInsert.rowsAffected) {
        await conn.commit();
        return;
      }

      // The row already exists. Need to verify team ID.
      const qSelect = "SELECT yaml FROM kurl_installer WHERE kurl_installer_id=? AND team_id=? FOR UPDATE";
      const vSelect = [installer.id, installer.teamID];

      const resultsSelect = await conn.query(qSelect, vSelect);
      if (resultsSelect.length === 0) {
        throw new Forbidden();
      }

      const qUpdate = "UPDATE kurl_installer SET yaml=? WHERE kurl_installer_id=? AND team_id=?";
      const vUpdate = [installer.toYAML(), installer.id, installer.teamID];

      await conn.query(qUpdate, vUpdate);

      await conn.commit();
    } catch(error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}
