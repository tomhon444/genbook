<?php if (!defined('BASEPATH') || ENVIRONMENT !== 'testing') exit;
// Not a fake successful login. If legacy switches back to SOAP, fail closed.
class Authen {
    function Staff_Verify($username, $password) { return FALSE; }
}
