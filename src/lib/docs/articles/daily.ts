import { can } from '@/lib/permissions';
import type { DocArticle } from '../types';

/**
 * Nghiệp vụ hằng ngày của đội kinh doanh — nhóm bài mọi nhân viên cần nhất.
 *
 * Điều kiện `visibleTo` hỏi CẢ `view-detail` lẫn `create`: `view-detail` là
 * điều kiện mở màn ở `lib/nav.ts`, `create` là điều kiện dùng được nút mà bài
 * hướng dẫn. Hỏi mỗi `create` thì người được cấp lẻ quyền tạo mà không có
 * quyền xem đọc được bài của một màn họ không mở được.
 */
export const DAILY_DOCS: DocArticle[] = [
  {
    slug: 'tao-khach-hang',
    title: 'Tạo khách hàng',
    screen: 'P-40',
    group: 'daily',
    summary: 'Lập hồ sơ khách mới. Tìm hồ sơ có sẵn trước để không lập trùng.',
    keywords: [
      'tạo khách hàng',
      'thêm khách',
      'khách mới',
      'hồ sơ khách',
      'lập hồ sơ',
      'CCCD trùng',
      'trùng hồ sơ',
      'báo lỗi CCCD',
      'tìm khách',
      '4 số cuối CCCD',
    ],
    visibleTo: () => true,
    blocks: [
      {
        kind: 'text',
        body: 'Mọi nghiệp vụ gắn vào một hồ sơ khách. Bạn lập hồ sơ một lần rồi dùng lại cho mở tài khoản ngân hàng, tạo đơn bảo hiểm và ghi dịch vụ.',
      },
      {
        kind: 'note',
        tone: 'warning',
        body: 'Hệ thống chặn CCCD trùng. Bạn tìm khách trước khi tạo. Khách đã có hồ sơ thì bạn dùng lại hồ sơ đó.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Ô tìm ở màn này chỉ hiện khách trong phạm vi của bạn. Nhân viên chỉ thấy khách chính mình lập. Muốn tìm cả công ty thì bạn mở hộp thoại **Tạo tài khoản ngân hàng**, **Tạo đơn bảo hiểm** hoặc **Ghi dịch vụ**. Ô **Tìm khách hàng** trong ba hộp thoại đó tra được mọi hồ sơ.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/customers-page.png',
          alt: 'Màn Khách hàng với ô tìm kiếm và nút Thêm khách hàng',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 36, label: 'Mục Khách hàng trên thanh điều hướng.' },
            { n: 2, x: 66.3, y: 4.1, label: 'Ô tìm kiếm — tìm hồ sơ khách đã có.' },
            { n: 3, x: 91, y: 4.1, label: 'Nút Thêm khách hàng mở biểu mẫu tạo hồ sơ.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Khách hàng** trên thanh điều hướng.',
          'Gõ tên hoặc số điện thoại vào ô tìm kiếm.',
          'Khách chưa có hồ sơ thì bạn bấm **Thêm khách hàng** ở góc trên bên phải.',
          'Điền **Họ tên**, **Ngày sinh**, **CCCD**, **Số điện thoại**.',
          'Ở ô **Địa chỉ**, bạn gõ để tìm Tỉnh, Xã, Ấp. Bạn chọn trong danh sách gợi ý rồi gõ thêm số nhà.',
          'Khách đến từ một kênh thì bạn chọn ô **Kênh (tuỳ chọn)**.',
          'Chọn kênh Bệnh viện thì bạn điền thêm ô **Bệnh viện**. Chọn kênh khác thì bạn điền ô **Chi tiết kênh**.',
          'Bấm **Tạo khách hàng** để lưu hồ sơ.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/customer-form.png',
          alt: 'Biểu mẫu Thêm khách hàng',
          width: 560,
          height: 588,
          markers: [
            { n: 1, x: 50, y: 16.7, label: 'Họ tên khách — bắt buộc.' },
            { n: 2, x: 73.8, y: 29.6, label: 'CCCD 12 số — hệ thống chặn số trùng.' },
            { n: 3, x: 50, y: 42.6, label: 'Địa chỉ — gõ để tìm, chọn xong gõ thêm số nhà.' },
            { n: 4, x: 38.1, y: 73.8, label: 'Số điện thoại liên lạc chính.' },
            { n: 5, x: 84, y: 93.8, label: 'Nút Tạo khách hàng — lưu hồ sơ.' },
          ],
        },
      },
    ],
  },
  {
    slug: 'ho-so-khach-hang',
    title: 'Xem hồ sơ khách hàng',
    screen: 'P-42',
    group: 'daily',
    summary: 'Xem trọn lịch sử của một khách: tài khoản, đơn bảo hiểm, dịch vụ, quà.',
    keywords: [
      'hồ sơ khách',
      'xem khách',
      'lịch sử khách',
      'khách đã mở gì',
      'chi tiết khách',
      'sửa hồ sơ khách',
    ],
    visibleTo: () => true,
    blocks: [
      {
        kind: 'text',
        body: 'Màn này gom mọi thứ của một khách vào một chỗ. Bạn mở nó khi cần biết khách đã mở tài khoản nào, mua đơn nào, nhận quà chưa.',
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Khách hàng**.',
          'Bấm vào tên khách trong bảng.',
          'Màn hồ sơ có năm khối: **Thông tin**, **Tài khoản ngân hàng**, **Đơn bảo hiểm**, **Dịch vụ đã làm**, **Quà**.',
          'Bấm **Sửa thông tin** để đổi tên, địa chỉ, số điện thoại.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/customer-detail-page.png',
          alt: 'Màn hồ sơ khách hàng với các khối thông tin',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 60.8, y: 19.9, label: 'Khối Thông tin — họ tên, địa chỉ, số điện thoại.' },
            { n: 2, x: 58.1, y: 59.8, label: 'Khối Tài khoản ngân hàng — các tài khoản khách đã mở.' },
          ],
        },
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Bốn nút ở khối Thông tin làm việc thẳng với khách này: **Sửa thông tin**, **Tặng quà**, **Mở ngân hàng**, **Ghi dịch vụ**.',
      },
    ],
  },
  {
    slug: 'mo-tai-khoan-ngan-hang',
    title: 'Mở tài khoản ngân hàng',
    screen: 'P-20',
    group: 'daily',
    summary: 'Bước một của luồng hai bước: giữ chỗ mã giới thiệu và tạo bản nháp.',
    keywords: [
      'mở tài khoản',
      'tài khoản ngân hàng',
      'mã giới thiệu',
      'bản nháp',
      'giữ chỗ',
      'đủ trần',
      'không mở thêm được',
      'VPBank',
      'MB',
      'BIDV',
      'LPB',
      'TPB',
      'SHB',
      'VIB',
      'MSB',
      'TCB',
    ],
    visibleTo: (user) =>
      can(user, 'banking', 'view-detail') && can(user, 'banking', 'create'),
    blocks: [
      {
        kind: 'text',
        body: 'Việc này có hai bước tách nhau. Bước một bạn giữ chỗ trên hệ thống. Bước hai bạn mở tài khoản thật ở ngân hàng rồi quay lại điền nốt.',
      },
      {
        kind: 'note',
        tone: 'warning',
        body: 'Bản nháp chiếm chỗ của mã giới thiệu ngay từ bước một. Bản nháp cũng tính vào trần số tài khoản của một khách. Khách đã đủ trần thì bạn xoá bớt bản nháp trước.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/banking-page.png',
          alt: 'Màn Ngân hàng với nút Tạo tài khoản ngân hàng',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 24, label: 'Mục Ngân hàng trên thanh điều hướng.' },
            { n: 2, x: 89.2, y: 4.1, label: 'Nút Tạo tài khoản ngân hàng — bước đầu là chọn khách.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Ngân hàng**.',
          'Bấm **Tạo tài khoản ngân hàng** ở góc trên bên phải.',
          'Gõ tên hoặc số điện thoại vào ô **Tìm khách hàng**, rồi bấm vào khách trong danh sách.',
          'Khách chưa có hồ sơ thì bạn bấm **Tạo KH mới**.',
          'Tích chọn ngân hàng muốn mở. Ngân hàng khách đã mở trước đó không hiện lại.',
          'Chọn mã giới thiệu cho từng ngân hàng đã tích. Hệ thống gợi ý sẵn mã dùng được cho phòng của bạn.',
          'Bấm **Tạo tài khoản**. Tích nhiều ngân hàng thì nút đổi thành **Tạo 2 tài khoản**, **Tạo 3 tài khoản**.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/customer-picker.png',
          alt: 'Hộp thoại chọn khách hàng',
          width: 560,
          height: 348,
          markers: [
            { n: 1, x: 50, y: 22.2, label: 'Ô Tìm khách hàng — tra được mọi hồ sơ trong công ty.' },
            { n: 2, x: 50, y: 58.5, label: 'Bấm một khách để sang bước điền biểu mẫu.' },
          ],
        },
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/bank-account-form.png',
          alt: 'Biểu mẫu Mở tài khoản ngân hàng',
          width: 560,
          height: 736,
          markers: [
            { n: 1, x: 12.1, y: 8.7, label: 'Danh sách ngân hàng — tích ngân hàng muốn mở.' },
            { n: 2, x: 52.7, y: 25.4, label: 'Ô mã giới thiệu — hệ thống gợi ý sẵn mã dùng được.' },
            { n: 3, x: 85.4, y: 95.1, label: 'Nút Tạo tài khoản — tạo bản nháp.' },
          ],
        },
      },
      {
        kind: 'text',
        body: 'Tài khoản vừa tạo nằm ở dạng bản nháp. Bạn mở tài khoản thật ở ngân hàng rồi làm tiếp theo bài **Hoàn tất tài khoản ngân hàng**.',
      },
    ],
  },
  {
    slug: 'hoan-tat-tai-khoan-ngan-hang',
    title: 'Hoàn tất tài khoản ngân hàng',
    screen: 'P-22',
    group: 'daily',
    summary: 'Bước hai: điền số tài khoản, tải ảnh chứng minh, bấm Hoàn thành.',
    keywords: [
      'hoàn thành tài khoản',
      'hoàn tất',
      'số tài khoản',
      'STK',
      'ảnh chứng minh',
      'CNKD',
      'HKD',
      'app ngân hàng',
      'xoá bản nháp',
      'huỷ tài khoản',
    ],
    visibleTo: (user) =>
      can(user, 'banking', 'view-detail') && can(user, 'banking', 'update'),
    blocks: [
      {
        kind: 'text',
        body: 'Bạn làm bước này sau khi mở tài khoản thật ở ngân hàng. Bấm **Hoàn thành** thì chỗ của mã giới thiệu chuyển từ *Đang giữ* sang *Đã dùng*.',
      },
      {
        kind: 'note',
        tone: 'warning',
        body: 'Bạn tải đủ số ảnh chứng minh thì nút **Hoàn thành** mới bấm được. Mỗi ngân hàng yêu cầu số ảnh khác nhau.',
      },
      {
        kind: 'note',
        tone: 'warning',
        body: 'Ảnh chứng minh chỉ sửa được trong ngày bạn hoàn thành tài khoản. Qua ngày sau bạn phải nhờ quản trị.',
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Ngân hàng**.',
          'Bấm vào dòng tài khoản đang ở trạng thái *Đang tạo*.',
          'Hộp thoại **Hoàn tất tài khoản** mở ra.',
          'Điền **Số tài khoản** và **Ngày mở**.',
          'Khách mở tài khoản hộ kinh doanh thì bạn tích **Mở tài khoản CNKD / HKD**.',
          'Khách đã cài app ngân hàng thì bạn tích ô tương ứng.',
          'Tải đủ ảnh chứng minh.',
          'Bấm **Hoàn thành**.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/bank-account-finish.png',
          alt: 'Màn Hoàn tất tài khoản ngân hàng',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 40.4, y: 58.2, label: 'Số tài khoản ngân hàng vừa mở.' },
            { n: 2, x: 78, y: 58.2, label: 'Ngày mở tài khoản.' },
            { n: 3, x: 59.2, y: 91.6, label: 'Ảnh chứng minh — tải đủ số ảnh thì nút Hoàn thành mới bấm được.' },
          ],
        },
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Hai ô **Mở tài khoản CNKD / HKD** và **Khách đã cài app ngân hàng** ảnh hưởng điểm KPI và trường hợp quà. Bạn tích đúng thực tế.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Nút **Xem hướng dẫn** ở đầu màn mở ảnh mẫu của chính ngân hàng đó.',
      },
      {
        kind: 'text',
        body: 'Khách đổi ý không mở nữa thì bạn xoá bản nháp. Nút xoá nằm ở cột **Thao tác** của bảng ngoài màn Ngân hàng. Xoá xong chỗ của mã giới thiệu quay lại kho.',
      },
    ],
  },
  {
    slug: 'tao-don-bao-hiem',
    title: 'Tạo đơn bảo hiểm',
    screen: 'P-13',
    group: 'daily',
    summary: 'Tạo đơn cho khách theo gói bảo hiểm. Đơn mới vào hàng chờ làm tay.',
    keywords: [
      'tạo đơn',
      'đơn bảo hiểm',
      'gói bảo hiểm',
      'bán bảo hiểm',
      'xe máy',
      'tai nạn điện',
      'phí bảo hiểm',
      'biển số xe',
    ],
    visibleTo: (user) =>
      can(user, 'insurance', 'view-detail') && can(user, 'insurance', 'create'),
    blocks: [
      {
        kind: 'text',
        body: 'Bạn tạo đơn cho một khách theo gói bảo hiểm công ty đang bán. Biểu mẫu hỏi thêm thông tin gì là tuỳ gói bạn chọn.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/insurance-page.png',
          alt: 'Màn Bảo hiểm với nút Tạo đơn bảo hiểm',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 18, label: 'Mục Bảo hiểm trên thanh điều hướng.' },
            { n: 2, x: 91, y: 4.1, label: 'Nút Tạo đơn bảo hiểm — bước đầu là chọn khách.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Bảo hiểm**.',
          'Bấm **Tạo đơn bảo hiểm** ở góc trên bên phải.',
          'Gõ vào ô **Tìm khách hàng**, rồi bấm vào khách trong danh sách.',
          'Chọn **Gói bảo hiểm**.',
          'Điền **Ngày tạo đơn**, **Ngày bắt đầu**, **Ngày kết thúc**, **Mức phí (đ)**.',
          'Gói xe máy thì bạn điền **Biển số xe**, **Loại xe**, **Số khung**, **Số máy**.',
          'Gói tai nạn điện thì bạn điền **Số thành viên** và **Số tiền bảo hiểm**.',
          'Ở khối **Khách hàng**, bạn bấm **Điền theo hồ sơ khách** để lấy sẵn thông tin.',
          'Bấm **Tạo đơn**.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/insurance-form.png',
          alt: 'Biểu mẫu Tạo đơn bảo hiểm',
          width: 560,
          height: 736,
          markers: [
            { n: 1, x: 50, y: 13.3, label: 'Gói bảo hiểm — quyết định biểu mẫu hỏi thêm ô nào.' },
            { n: 2, x: 50, y: 85.3, label: 'Khối Khách hàng — nút Điền theo hồ sơ khách lấy sẵn thông tin.' },
            { n: 3, x: 88.6, y: 95.1, label: 'Nút Tạo đơn.' },
          ],
        },
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Danh sách gói lấy từ màn **Cấu hình → Danh mục quà & gói BH**. Thiếu gói cần bán thì bạn báo người quản trị bật gói đó.',
      },
      {
        kind: 'note',
        tone: 'warning',
        body: 'Bấm **Tạo đơn** chưa phải là xong. Đơn mới vào hàng chờ và cần người nhập tay lên PVI. Bạn xem bài **Xử lý đơn chờ làm tay**.',
      },
    ],
  },
  {
    slug: 'xu-ly-don-cho-lam-tay',
    title: 'Xử lý đơn chờ làm tay',
    screen: 'P-14',
    group: 'daily',
    summary: 'Nhận đơn từ hàng chờ và nhập tay lên web PVI.',
    keywords: [
      'chờ làm tay',
      'nhận xử lý',
      'đơn lỗi',
      'hàng chờ',
      'PVI',
      'nhập tay',
      'đơn chưa lên PVI',
      'đang làm tay',
    ],
    visibleTo: (user) =>
      can(user, 'insurance', 'view-detail') && can(user, 'insurance', 'handle-fallback'),
    blocks: [
      {
        kind: 'text',
        body: 'Đơn bảo hiểm mới nằm ở trạng thái *Chờ làm tay*. Bạn nhận đơn rồi tự nhập lên web PVI. Đơn ở hàng chờ là kho chung, ai có quyền cũng nhận được.',
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Bảo hiểm**.',
          'Bấm **Bộ lọc**, chọn trạng thái *Chờ làm tay*.',
          'Bấm nút **Nhận xử lý** ở cột Thao tác của dòng đơn.',
          'Đơn chuyển sang trạng thái *Đang làm tay* và ghi tên bạn.',
          'Mở web PVI, nhập đơn theo đúng thông tin trên màn chi tiết.',
          'Nhập xong bạn quay lại đổi trạng thái đơn.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/insurance-queue.png',
          alt: 'Màn Bảo hiểm với nút Nhận xử lý ở cột Thao tác',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 79.2, y: 4.1, label: 'Nút Bộ lọc — lọc trạng thái Chờ làm tay.' },
            { n: 2, x: 92.1, y: 26.8, label: 'Nút Nhận xử lý — nhận đơn về mình.' },
          ],
        },
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Bạn nhận đơn trước khi mở web PVI. Nhận đơn là cách báo cho người khác biết đơn này đã có người làm.',
      },
    ],
  },
  {
    slug: 'ghi-dich-vu',
    title: 'Ghi dịch vụ',
    screen: 'P-31',
    group: 'daily',
    summary: 'Ghi một lượt dịch vụ đã làm cho khách. Điểm KPI tính theo loại dịch vụ.',
    keywords: [
      'ghi dịch vụ',
      'dịch vụ',
      'nhập dịch vụ',
      'khai dịch vụ',
      'làm dịch vụ',
      'điểm dịch vụ',
    ],
    visibleTo: (user) =>
      can(user, 'services', 'view-detail') && can(user, 'services', 'create'),
    blocks: [
      {
        kind: 'text',
        body: 'Bạn ghi lại một lượt dịch vụ đã làm cho khách. Hệ thống tính điểm KPI theo hệ số của loại dịch vụ bạn chọn.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/services-page.png',
          alt: 'Màn Dịch vụ với nút Ghi dịch vụ',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 30, label: 'Mục Dịch vụ trên thanh điều hướng.' },
            { n: 2, x: 92.7, y: 4.1, label: 'Nút Ghi dịch vụ — bước đầu là chọn khách.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Dịch vụ**.',
          'Bấm **Ghi dịch vụ** ở góc trên bên phải.',
          'Gõ vào ô **Tìm khách hàng**, rồi bấm vào khách trong danh sách.',
          'Chọn **Loại dịch vụ** và **Ngày thực hiện**.',
          'Chọn **Tỉnh/thành phố**, rồi chọn **Xã/phường**.',
          'Điền **Ghi chú công việc** nếu cần.',
          'Bấm **Lưu**.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/service-form.png',
          alt: 'Biểu mẫu Ghi dịch vụ',
          width: 560,
          height: 421,
          markers: [
            { n: 1, x: 50, y: 23.3, label: 'Loại dịch vụ — quyết định hệ số điểm KPI.' },
            { n: 2, x: 50, y: 41.4, label: 'Ngày thực hiện.' },
            { n: 3, x: 50, y: 59.5, label: 'Nơi làm dịch vụ — chọn tỉnh rồi xã/phường.' },
            { n: 4, x: 91.2, y: 91.4, label: 'Nút Lưu.' },
          ],
        },
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Người quản trị đặt hệ số điểm của từng loại ở màn **Cấu hình → Loại dịch vụ**.',
      },
    ],
  },
  {
    slug: 'tang-qua-cho-khach',
    title: 'Tặng quà cho khách',
    screen: 'P-41',
    group: 'daily',
    summary: 'Chọn quà trong rổ quà của khách rồi xác nhận đã phát.',
    keywords: [
      'tặng quà',
      'phát quà',
      'chốt quà',
      'rổ quà',
      'khách đủ điều kiện nhận quà',
      'quà của khách',
    ],
    visibleTo: (user) => can(user, 'banking', 'grant-gift'),
    blocks: [
      {
        kind: 'text',
        body: 'Hệ thống tự tính khách đủ điều kiện nhận quà nào. Bạn chọn một món trong rổ quà đó rồi xác nhận đã phát.',
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Khách hàng**, hoặc mở hồ sơ của khách.',
          'Bấm nút **Tặng quà** ở dòng của khách.',
          'Hộp thoại hiện rổ quà khách đủ điều kiện nhận.',
          'Chọn một món quà.',
          'Bấm **Xác nhận**.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/gift-button.png',
          alt: 'Màn Khách hàng với nút Tặng quà ở cột Thao tác',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 82.5, y: 26.6, label: 'Nút Tặng quà ở dòng của khách.' },
          ],
        },
      },
      {
        kind: 'note',
        tone: 'warning',
        body: 'Bạn xác nhận rồi thì nút **Tặng quà** của khách đó khoá lại. Bạn chọn đúng món trước khi bấm.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Rổ quà rỗng nghĩa là khách chưa đủ điều kiện. Bạn xem luật ở màn **Cấu hình → Quy tắc quà**.',
      },
    ],
  },
];
