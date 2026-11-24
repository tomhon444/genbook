<?php if (!defined('BASEPATH') || ENVIRONMENT !== 'testing') exit;
// Read-only inspection inside the ignored sandbox copy. Never installed in app/.
class Sandbox_identity extends CI_Controller {
    function index() {
        $id = $this->session->userdata('user_id');
        if (!$this->session->userdata('logged_in') || strpos((string)$id, 'T02-') !== 0) {
            header('HTTP/1.1 401 Unauthorized');
            echo json_encode(array('authenticated' => false));
            return;
        }
        header('Content-Type: application/json');
        header('Cache-Control: no-store');
        echo json_encode(array(
            'authenticated' => true,
            'staffId' => $id,
            'departmentId' => $this->session->userdata('user_dept'),
            'role' => $this->session->userdata('user_level')
        ));
    }
}
