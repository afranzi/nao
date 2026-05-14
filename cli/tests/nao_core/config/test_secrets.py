import base64
import os
from unittest.mock import MagicMock, patch

import pytest

from nao_core.config import secrets

# ---------------------------------------------------------------------------
# env resolver
# ---------------------------------------------------------------------------


def test_resolve_env_returns_value_from_environment():
    with patch.dict(os.environ, {"FOO": "bar"}):
        assert secrets.resolve_env("FOO") == "bar"


def test_resolve_env_returns_none_when_unset():
    with patch.dict(os.environ, {}, clear=True):
        assert secrets.resolve_env("MISSING") is None


def test_resolve_env_returns_none_for_empty_string():
    with patch.dict(os.environ, {"EMPTY": ""}):
        assert secrets.resolve_env("EMPTY") is None


def test_resolve_env_extra_env_takes_precedence():
    with patch.dict(os.environ, {"FOO": "from_env"}):
        assert secrets.resolve_env("FOO", extra_env={"FOO": "from_extra"}) == "from_extra"


# ---------------------------------------------------------------------------
# process_secrets dispatch
# ---------------------------------------------------------------------------


def test_process_secrets_replaces_env_token():
    with patch.dict(os.environ, {"DB_HOST": "localhost"}):
        rendered, missing = secrets.process_secrets("host: {{ env('DB_HOST') }}")
    assert rendered == "host: localhost"
    assert missing == {}


def test_process_secrets_tracks_missing_env():
    with patch.dict(os.environ, {}, clear=True):
        rendered, missing = secrets.process_secrets("host: {{ env('MISSING') }}")
    assert rendered == "host: "
    assert missing == {"MISSING": None}


def test_process_secrets_dispatches_to_aws_resolver():
    with patch.object(secrets, "resolve_aws", return_value="s3cr3t") as mock_aws:
        rendered, missing = secrets.process_secrets("password: {{ aws('db/password') }}")
    mock_aws.assert_called_once_with("db/password")
    assert rendered == "password: s3cr3t"
    assert missing == {}


def test_process_secrets_dispatches_to_k8s_resolver():
    with patch.object(secrets, "resolve_k8s", return_value="kv") as mock_k8s:
        rendered, missing = secrets.process_secrets("token: {{ k8s('ns/sec/field') }}")
    mock_k8s.assert_called_once_with("ns/sec/field")
    assert rendered == "token: kv"
    assert missing == {}


def test_process_secrets_supports_dollar_prefix_for_all_protocols():
    with (
        patch.object(secrets, "resolve_aws", return_value="v"),
        patch.dict(os.environ, {"X": "y"}),
    ):
        rendered, _ = secrets.process_secrets("a: ${{ aws('x/y') }}, b: ${{ env('X') }}")
    assert rendered == "a: v, b: y"


def test_process_secrets_mixed_protocols_in_one_document():
    with (
        patch.dict(os.environ, {"DB_HOST": "localhost"}),
        patch.object(secrets, "resolve_aws", return_value="awspw"),
        patch.object(secrets, "resolve_k8s", return_value="k8stok"),
    ):
        rendered, missing = secrets.process_secrets(
            "host: {{ env('DB_HOST') }}\n"
            "password: {{ aws('db/password') }}\n"
            "token: {{ k8s('default/api/token') }}\n"
        )
    assert rendered == "host: localhost\npassword: awspw\ntoken: k8stok\n"
    assert missing == {}


# ---------------------------------------------------------------------------
# AWS identifier parsing
# ---------------------------------------------------------------------------


def test_split_aws_identifier_simple_form():
    assert secrets._split_aws_identifier("name/field") == ("name", "field")


def test_split_aws_identifier_arn_form():
    arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-AbCdEf"
    assert secrets._split_aws_identifier(f"{arn}/password") == (arn, "password")


def test_split_aws_identifier_rejects_missing_slash():
    with pytest.raises(ValueError, match="secret_name/field"):
        secrets._split_aws_identifier("no_slash")


def test_split_aws_identifier_rejects_empty_parts():
    with pytest.raises(ValueError, match="secret_name/field"):
        secrets._split_aws_identifier("name/")


def test_aws_region_from_arn():
    arn = "arn:aws:secretsmanager:eu-west-2:123456789012:secret:foo"
    assert secrets._aws_region_from_arn(arn) == "eu-west-2"


def test_aws_region_from_plain_name_is_none():
    assert secrets._aws_region_from_arn("plain_secret") is None


# ---------------------------------------------------------------------------
# Kubernetes identifier parsing
# ---------------------------------------------------------------------------


def test_split_k8s_identifier_with_namespace():
    assert secrets._split_k8s_identifier("kube-system/foo/bar") == ("kube-system", "foo", "bar")


def test_split_k8s_identifier_defaults_to_pod_namespace(monkeypatch):
    monkeypatch.setattr(secrets, "_pod_namespace", lambda: "my-ns")
    assert secrets._split_k8s_identifier("foo/bar") == ("my-ns", "foo", "bar")


def test_split_k8s_identifier_rejects_bad_format():
    with pytest.raises(ValueError, match="namespace/secret/field"):
        secrets._split_k8s_identifier("only_one")


def test_split_k8s_identifier_rejects_too_many_parts():
    with pytest.raises(ValueError, match="namespace/secret/field"):
        secrets._split_k8s_identifier("a/b/c/d")


def test_pod_namespace_falls_back_to_default(monkeypatch):
    monkeypatch.setattr(secrets, "_K8S_NAMESPACE_FILE", "/nonexistent/path")
    assert secrets._pod_namespace() == "default"


# ---------------------------------------------------------------------------
# AWS resolver (with mocked boto3)
# ---------------------------------------------------------------------------


def _install_fake_boto3(monkeypatch, secret_string: str | None) -> MagicMock:
    fake_client = MagicMock()
    fake_client.get_secret_value.return_value = {"SecretString": secret_string}
    fake_session = MagicMock()
    fake_session.client.return_value = fake_client
    fake_boto3 = MagicMock()
    fake_boto3.session.Session.return_value = fake_session

    fake_botocore_exceptions = MagicMock()
    fake_botocore_exceptions.ClientError = Exception

    import sys

    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)
    monkeypatch.setitem(sys.modules, "botocore", MagicMock())
    monkeypatch.setitem(sys.modules, "botocore.exceptions", fake_botocore_exceptions)
    monkeypatch.setattr(secrets, "require_dependency", lambda *a, **kw: None)
    return fake_client


def test_resolve_aws_returns_field_from_json_payload(monkeypatch):
    _install_fake_boto3(monkeypatch, '{"username": "u", "password": "p"}')
    assert secrets.resolve_aws("my_secret/password") == "p"


def test_resolve_aws_raises_when_payload_is_not_json(monkeypatch):
    _install_fake_boto3(monkeypatch, "not-json")
    with pytest.raises(ValueError, match="not valid JSON"):
        secrets.resolve_aws("my_secret/password")


def test_resolve_aws_raises_when_field_is_missing(monkeypatch):
    _install_fake_boto3(monkeypatch, '{"username": "u"}')
    with pytest.raises(ValueError, match="has no field 'password'"):
        secrets.resolve_aws("my_secret/password")


def test_resolve_aws_raises_when_secret_string_is_empty(monkeypatch):
    _install_fake_boto3(monkeypatch, None)
    with pytest.raises(ValueError, match="no SecretString payload"):
        secrets.resolve_aws("my_secret/password")


def test_resolve_aws_uses_region_from_arn(monkeypatch):
    fake_client = _install_fake_boto3(monkeypatch, '{"x": "y"}')
    arn = "arn:aws:secretsmanager:eu-west-3:111122223333:secret:foo-AbCdEf"
    secrets.resolve_aws(f"{arn}/x")

    import sys

    fake_boto3 = sys.modules["boto3"]
    fake_boto3.session.Session.assert_called_once_with(region_name="eu-west-3")
    fake_client.get_secret_value.assert_called_once_with(SecretId=arn)


# ---------------------------------------------------------------------------
# Kubernetes resolver (with mocked kubernetes client)
# ---------------------------------------------------------------------------


def _install_fake_kubernetes(monkeypatch, data: dict[str, str] | None) -> MagicMock:
    secret_obj = MagicMock()
    secret_obj.data = data

    fake_v1 = MagicMock()
    fake_v1.read_namespaced_secret.return_value = secret_obj

    fake_client_module = MagicMock()
    fake_client_module.CoreV1Api.return_value = fake_v1

    fake_config_module = MagicMock()

    fake_kubernetes = MagicMock()
    fake_kubernetes.client = fake_client_module
    fake_kubernetes.config = fake_config_module

    import sys

    monkeypatch.setitem(sys.modules, "kubernetes", fake_kubernetes)
    monkeypatch.setitem(sys.modules, "kubernetes.client", fake_client_module)
    monkeypatch.setitem(sys.modules, "kubernetes.config", fake_config_module)
    monkeypatch.setattr(secrets, "require_dependency", lambda *a, **kw: None)
    monkeypatch.setattr(secrets, "_load_kube_config", lambda: None)
    return fake_v1


def test_resolve_k8s_returns_base64_decoded_field(monkeypatch):
    encoded = base64.b64encode(b"super-secret").decode()
    _install_fake_kubernetes(monkeypatch, {"password": encoded})

    assert secrets.resolve_k8s("default/db/password") == "super-secret"


def test_resolve_k8s_raises_when_field_missing(monkeypatch):
    _install_fake_kubernetes(monkeypatch, {"other": "Zm9v"})

    with pytest.raises(ValueError, match="has no field 'password'"):
        secrets.resolve_k8s("default/db/password")


def test_resolve_k8s_uses_pod_namespace_when_omitted(monkeypatch):
    encoded = base64.b64encode(b"v").decode()
    fake_v1 = _install_fake_kubernetes(monkeypatch, {"f": encoded})
    monkeypatch.setattr(secrets, "_pod_namespace", lambda: "my-ns")

    secrets.resolve_k8s("db/f")
    fake_v1.read_namespaced_secret.assert_called_once_with(name="db", namespace="my-ns")
